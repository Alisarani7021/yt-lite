import SEARCH_HTML from "./search.html";
import SHELL_HTML from "./shell.html";
import PARTY_TEMPLATE from "./party.html";
import SEMINAR_BODY from "./seminar_body.html";
import DUB_BODY from "./dub_body.html";
import SETUP_HTML from "./setup.html";
// ─── یوتیوب لایت (YouTube Lite) ───
// یک فرانت‌اند سبک و مستقل برای YouTube روی Cloudflare Workers
// بدون تبلیغات، بدون صفحه رضایت (consent)، بدون ردیابی
// جستجو با کلاینت WEB — پخش با کلاینت ANDROID_VR (URLهای مستقیم و قابل پخش)

const API_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";
const VISITOR = "CgJVUxIEGgAgbQ%3D%3D";

const CLIENTS = {
  WEB: {
    name: "WEB", id: "1", version: "2.20241001.00.00",
    ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    key: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
  },
  VR: {
    name: "ANDROID_VR", id: "28", version: "1.60.19",
    ua: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
    extra: { androidSdkVersion: 32, osName: "Android", osVersion: "12L" },
    key: "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8",
  },
  ANDROID: {
    name: "ANDROID", id: "3", version: "20.10.38",
    ua: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
    extra: { androidSdkVersion: 34, osName: "Android", osVersion: "14", platform: "MOBILE" },
    key: "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w",
  },
  IOS: {
    name: "IOS", id: "5", version: "20.10.4",
    ua: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3 like Mac OS X)",
    extra: { osName: "iPhone", osVersion: "18.3.18D70", deviceMake: "Apple", deviceModel: "iPhone16,2" },
    key: "AIzaSyB-63vPrdThhKuerbB2N_l7Kwwcxj6yUAc",
  },
};

// ترتیب تلاش برای player: هر کلاینت روی مجموعه متفاوتی از ویدیوها OK می‌دهد
const PLAYER_CLIENTS = ["VR", "ANDROID", "IOS", "WEB"];

async function innerTube(endpoint, body, clientKey) {
  const c = CLIENTS[clientKey];
  const client = {
    hl: "en", gl: "US",
    clientName: c.name, clientVersion: c.version,
    visitorData: VISITOR,
    ...(c.extra || {}),
  };
  const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?key=${c.key}&prettyPrint=false`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": c.ua,
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com/",
      "X-YouTube-Client-Name": c.id,
      "X-YouTube-Client-Version": c.version,
      "Accept-Language": "en-US,en;q=0.9",
      // کوکی حساب یوتیوب (اختیاری، فقط روی Worker خودت به‌صورت secret تنظیم می‌شود)
      ...(YT_COOKIE ? { "Cookie": YT_COOKIE } : {}),
    },
    body: JSON.stringify({ context: { client }, ...body }),
  });
  if (!res.ok) throw new Error("YouTube API " + res.status);
  return res.json();
}
let YT_COOKIE = "";

// ─── کش پاسخ player ───
// لایهٔ ۱: کش مشترک KV — یک fetch برای همهٔ کاربرها (کلیدها بر اساس colo تفکیک می‌شوند)
// لایهٔ ۲: کش حافظهٔ ایزوله
let KV = null; // در wrangler.toml تعریف می‌شود (اختیاری)
const playerCache = new Map();
const PLAYER_TTL = 240 * 1000;

async function getPlayer(videoId, noCache = false, force = false, colo = "?") {
  const kvKey = "p:" + colo + ":" + videoId;
  // ۱. کش مشترک — با یک fetch، همهٔ کاربرهای این colo سرویس می‌گیرند
  if (KV && !force && !noCache) {
    try {
      const hit = await KV.get(kvKey, { type: "json" });
      if (hit) {
        playerCache.set(videoId, { ts: Date.now(), data: hit, ttl: PLAYER_TTL });
        if (playerCache.size > 200) playerCache.delete(playerCache.keys().next().value);
        return hit;
      }
    } catch (e) { /* خطای KV — ادامه می‌دهیم */ }
  }
  // ۲. کش حافظهٔ ایزوله
  if (!noCache && !force) {
    const hit = playerCache.get(videoId);
    if (hit && Date.now() - hit.ts < (hit.ttl || PLAYER_TTL)) return hit.data;
  }
  // ۳. گرفتن از YouTube — سه پاس با مکث بینشان: بررسی «ربات» یوتیوب احتمالاتی است
  let data = null, lastBad = null, lastErr = null, okClient = null;
  const delays = [0, 1200, 2500];
  for (let pass = 0; pass < delays.length && !data; pass++) {
    if (delays[pass]) await new Promise(r => setTimeout(r, delays[pass])); // مکث کوتاه قبل از پاس بعدی
    for (const ck of PLAYER_CLIENTS) {
      try {
        const d = await innerTube("player", { videoId }, ck);
        const st = d && d.playabilityStatus && d.playabilityStatus.status;
        if (st === "OK") { data = d; okClient = ck; break; }
        lastBad = d;
      } catch (e) { lastErr = e; }
    }
  }
  const out = data || lastBad;
  if (!out) throw (lastErr || new Error("player failed"));
  if (okClient) out.__client = okClient; // برای UA درست در استریم
  // نتیجه منفی (bot-check) کوتاه‌مدت کش شود تا کاربر بتواند زودتر دوباره امتحان کند
  const ttl = data ? PLAYER_TTL : 60 * 1000;
  playerCache.set(videoId, { ts: Date.now(), data: out, ttl });
  if (playerCache.size > 200) playerCache.delete(playerCache.keys().next().value);
  // ۴. نوشتن در کش مشترک — بقیهٔ کاربرها هم با همان نتیجه سرویس می‌گیرند
  if (KV) {
    try {
      await KV.put(kvKey, JSON.stringify(out), { expirationTtl: Math.max(60, Math.round(ttl / 1000)) });
    } catch (e) { /* بیخیال — کش حافظه کار را انجام می‌دهد */ }
  }
  return out;
}

function findFormat(player, itag) {
  const sd = player && player.streamingData;
  if (!sd) return null;
  const all = [...(sd.formats || []), ...(sd.adaptiveFormats || [])];
  return all.find(f => String(f.itag) === String(itag) && f.url) || null;
}

function allFormats(player) {
  const sd = (player && player.streamingData) || {};
  const progressive = (sd.formats || []).filter(f => f.url)
    .sort((a, b) => (b.height || 0) - (a.height || 0));
  const adaptive = (sd.adaptiveFormats || []).filter(f => f.url);
  const audio = adaptive.filter(f => /audio/.test(f.mimeType || ""))
    .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
  const videoOnly = adaptive.filter(f => /video/.test(f.mimeType || ""))
    .sort((a, b) => {
      const pa = /video\/mp4/.test(a.mimeType || "") ? 0 : 1;
      const pb = /video\/mp4/.test(b.mimeType || "") ? 0 : 1;
      if (pa !== pb) return pa - pb; // mp4 اول (سازگاری با Safari)
      return (b.height || 0) - (a.height || 0);
    });
  return { progressive, audio, videoOnly };
}

// ─── استریم ویدیو/صدا از googlevideo با پشتیبانی Range ───
async function fetchGooglevideo(target, request, clientKey) {
  const headers = new Headers();
  const range = request.headers.get("range");
  if (range) headers.set("Range", range);
  const c = CLIENTS[clientKey] || CLIENTS.VR;
  headers.set("User-Agent", c.ua);
  headers.set("Referer", "https://www.youtube.com/");
  try {
    return await fetch(target, { headers, redirect: "follow" });
  } catch (e) {
    return null;
  }
}

async function handleStream(request, url) {
  const v = url.searchParams.get("v");
  const itag = url.searchParams.get("itag");
  const download = url.searchParams.get("download") === "1";
  if (!v || !itag) return htmlPage("خطا", "<p class='center'>پارامتر ناقص است.</p>", 400);
  const colo = (request.cf && request.cf.colo) || "?";

  let player = await getPlayer(v, false, false, colo);
  let fmt = findFormat(player, itag);
  let res = fmt ? await fetchGooglevideo(fmt.url, request, player.__client) : null;

  // اگر 403 شد (URL منقضی یا نتیجهٔ کشِ coloی دیگر)، یک بار تازه از همین colo می‌گیریم
  if (!res || res.status === 403) {
    player = await getPlayer(v, true, true, colo);
    fmt = findFormat(player, itag);
    res = fmt ? await fetchGooglevideo(fmt.url, request, player.__client) : null;
  }
  const psS = player.playabilityStatus || {};
  if (psS.status && psS.status !== "OK") return lockedPage(v, itag, psS.reason || psS.status);
  if (!fmt) return htmlPage("استریم پیدا نشد", "<p class='center'>این کیفیت برای این ویدیو موجود نیست. <a href='/watch?v=" + encodeURIComponent(v) + "'>بازگشت به ویدیو</a></p>", 404);
  if (!res) return htmlPage("خطای استریم", "<p class='center'>خطا در دریافت استریم از YouTube — <a href='#' onclick='location.reload();return false'>دوباره امتحان کن</a></p>", 502);

  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
    const val = res.headers.get(h);
    if (val) headers.set(h, val);
  }
  headers.set("cache-control", "no-store");
  headers.set("access-control-allow-origin", "*");
  if (download) {
    const ext = mimeExt(fmt.mimeType);
    const name = ((player.videoDetails && player.videoDetails.title) || v) + "_" + itag + ext;
    headers.set("content-disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(name));
  }
  return new Response(res.body, { status: res.status, headers });
}

// ─── پروکسی تصاویر (فقط ytimg / ggpht) ───
async function handleImg(url) {
  const u = url.searchParams.get("u");
  if (!u) return new Response("", { status: 400 });
  let target;
  try { target = new URL(u); } catch (e) { return new Response("", { status: 400 }); }
  if (!/(\.|^)ytimg\.com$/.test(target.hostname) && !/(\.|^)ggpht\.com$/.test(target.hostname)) {
    return new Response("", { status: 403 });
  }
  try {
    const res = await fetch(target.toString(), {
      headers: { "User-Agent": CLIENTS.WEB.ua, "Referer": "https://www.youtube.com/" },
    });
    const headers = new Headers();
    headers.set("content-type", res.headers.get("content-type") || "image/jpeg");
    headers.set("cache-control", "public, max-age=86400");
    headers.set("access-control-allow-origin", "*");
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    return new Response("", { status: 502 });
  }
}

// ─── جستجو ───
function chId(v) {
  let id = "";
  walk(v.ownerText || v.longBylineText || {}, (o) => {
    const b = o && o.browseId;
    if (!id && typeof b === "string" && /^UC/.test(b)) id = b;
  });
  return id;
}

// ─── صفحهٔ کانال: ویدیوهای کانال ───
async function handleChannel(url) {
  const tab = (url.searchParams.get("tab") || "").trim();
  const id = (url.searchParams.get("id") || "").trim();
  if (!/^UC[\w-]{10,}$/.test(id)) return Response.redirect(new URL("/", url), 302);
  let data;
  try {
    data = await innerTube("browse", tab ? { browseId: id, params: tab } : { browseId: id }, "WEB");
  } catch (e) {
    return htmlPage("خطا", `<p class='center'>خطا در باز کردن کانال: ${esc(e.message)} — <a href='/'>خانه</a></p>`, 502);
  }
  const name = ((data.metadata || {}).channelMetadataRenderer || {}).title || ((data.header || {}).c4TabbedHeaderRenderer || {}).title || "کانال";
  const vids = [];
  const seen = new Set();
  // صفحهٔ کانال: دو قالب ممکن است — videoRenderer قدیمی یا lockupViewModel جدید
  const items = [];
  walk(data, (o) => {
    if (o && o.videoRenderer && o.videoRenderer.videoId && !seen.has(o.videoRenderer.videoId)) {
      seen.add(o.videoRenderer.videoId); items.push({ id: o.videoRenderer.videoId, title: vTitle(o.videoRenderer), sub: vViews(o.videoRenderer), dur: vDuration(o.videoRenderer), th: vThumb(o.videoRenderer) });
    }
    if (o && o.shortsLockupViewModel) {
      const sv = o.shortsLockupViewModel;
      const sid = (((sv.onTap || {}).innertubeCommand || {}).reelWatchEndpoint || {}).videoId;
      if (sid && !seen.has(sid)) {
        seen.add(sid);
        items.push({ id: sid, title: ((sv.overlayMetadata || {}).primaryText || {}).content || "", sub: "", dur: "", th: "" });
      }
    }
    if (o && o.lockupViewModel && o.lockupViewModel.contentId && !seen.has(o.lockupViewModel.contentId)) {
      const lv = o.lockupViewModel;
      if (lv.contentType && !/VIDEO/.test(lv.contentType)) return;
      const lm = (((lv.metadata || {}).lockupMetadataViewModel) || {});
      const title = ((lm.title || {}).content) || "";
      seen.add(lv.contentId);
      items.push({ id: lv.contentId, title, sub: "", dur: "", th: "" });
    }
  });
  const rows = items.slice(0, 40).map(v => {
    return `<a class="vrow" href="/watch?v=${encodeURIComponent(v.id)}">
      <img src="${v.th ? "/img?u=" + encodeURIComponent(v.th) : "https://i.ytimg.com/vi/" + encodeURIComponent(v.id) + "/hqdefault.jpg"}" alt="" loading="lazy">
      <div class="vmeta">
        <span class="vtitle">${esc(v.title)}</span>
        <div class="vsub">${v.dur ? `<span class="badge">${esc(v.dur)}</span>` : ""}${v.sub ? ` · ${esc(v.sub)}` : ""}</div>
      </div>
    </a>`;
  }).join("");
  const tabsRoot = ((data.contents || {}).twoColumnBrowseResultsRenderer || {}).tabs || [];
  const tabsList = [];
  tabsRoot.forEach(t => { const r = t.tabRenderer; if (!r) return; const pp = ((r.endpoint || {}).browseEndpoint || {}).params; if (pp) tabsList.push({ title: r.title, p: pp }); });
  const tabsBar = tabsList.length ? '<div class="chips">' + tabsList.map(x => '<a class="chip' + (x.p === tab ? ' on' : '') + '" href="/channel?id=' + encodeURIComponent(id) + '&tab=' + encodeURIComponent(x.p) + '">' + esc(x.title) + '</a>').join("") + '</div>' : "";
  return htmlPage(String(name), `
    <h2 style="margin:18px 0 10px;font-size:20px">${esc(String(name))}</h2>
    ${tabsBar}
    ${items.length ? `<div class="vlist">${rows}</div>` : `<p class="note">ویدیویی برای این کانال پیدا نشد.</p>`}
  `);
}

async function handleSearch(url) {
  const q = (url.searchParams.get("q") || "").trim();
  if (!q) return Response.redirect(new URL("/", url), 302);
  let data;
  try {
    data = await innerTube("search", { query: q }, "WEB");
  } catch (e) {
    return htmlPage("خطا", `<p class='center'>خطا در جستجو: ${esc(e.message)} — <a href='/'>تلاش دوباره</a></p>`, 502);
  }
  const vids = [];
  const seen = new Set();
  walk(data, (o) => {
    if (o && o.videoRenderer && o.videoRenderer.videoId && !seen.has(o.videoRenderer.videoId)) {
      seen.add(o.videoRenderer.videoId);
      vids.push(o.videoRenderer);
    }
  });
  const rows = vids.slice(0, 25).map(v => {
    const id = v.videoId;
    const t = vTitle(v), ch = vChannel(v), dur = vDuration(v), views = vViews(v), th = vThumb(v);
    return `<a class="vrow" href="/watch?v=${encodeURIComponent(id)}">
      <img src="/img?u=${encodeURIComponent(th)}" alt="" loading="lazy">
      <div class="vmeta">
        <span class="vtitle">${esc(t)}</span>
        <div class="vsub">${chId(v) ? `<a href="/channel?id=${encodeURIComponent(chId(v))}" style="color:#aaa">${esc(ch)}</a>` : esc(ch)}${dur ? ` · <span class="badge">${esc(dur)}</span>` : ""}${views ? ` · ${esc(views)}` : ""}</div>
      </div>
    </a>`;
  }).join("");

  const rowsData = vids.slice(0, 60).map(v => [
    v.videoId, vTitle(v) || "", vChannel(v) || "", chId(v) || "", vDuration(v) || "", vViews(v) || ""
  ]);
  const safeJson = (x) => JSON.stringify(x).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
  const html = SEARCH_HTML
    .replace("__DATA__", () => safeJson(rowsData))
    .replace(/__Q__/g, () => esc(q));
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

async function handleSearchOld(q, rows) {
  return htmlPage("جستجو: " + q, `
    <h2 style="margin:18px 0 10px;font-size:20px">نتایج جستجو برای «${esc(q)}»</h2>
    ${vids.length ? `<div class="vlist">${rows}</div>` : `<p class="note">نتیجه‌ای پیدا نشد. عبارت دیگری را امتحان کنید.</p>`}
  `);
}

// ─── صفحهٔ خطای «قفل ربات» — با تلاش خودکار ───
function lockedPage(v, itag, reason) {
  const base = `/watch?v=${encodeURIComponent(v)}${itag ? "&itag=" + encodeURIComponent(itag) : ""}`;
  const freshHref = base + "&fresh=1"; // تلاش خودکار: کش حافظه رد می‌شود، کش مشترک نه
  const forceHref = base + "&force=1"; // دکمهٔ دستی: یک تلاش کاملاً تازه
  return htmlPage("قابل پخش نیست", `
    <div class='center' style='padding-top:40px'>
      <div style='font-size:46px'>🤖</div>
      <h1 style='font-size:19px;margin:10px 0 4px'>این ویدیو فعلاً توسط YouTube قفل شده</h1>
      <p class='note' style='max-width:460px;margin:8px auto 0;line-height:2'>
        یوتیوب برای این ویدیو تأیید «ربات نبودن» می‌خواهد (<b>${esc(reason)}</b>).<br>
        این قفل <b>موقت</b> است و معمولاً ظرف ۱ تا ۲ دقیقه باز می‌شود.<br>
        صفحه <b>خودکار</b> چند بار دیگر با فاصله امتحان می‌کند — لازم نیست کاری بکنید. 🙂
      </p>
      <p class='note' style='max-width:460px;margin:10px auto 0;line-height:2;color:#8ab4f8'>
        💡 نکته: اگر VPN (فیلترشکن) روشن باشد، شانس پخش بیشتر است — چون درخواست از سرور دیگری به یوتیوب می‌رسد.
      </p>
      <p class='note' id='autoNote' style='color:#ff6b7a;margin-top:14px'>تلاش خودکار بعدی تا <b id='cnt'>۲۰</b> ثانیهٔ دیگر… (تلاش <b id='att'>۱</b> از ۴)</p>
      <p style='margin:26px 0 10px'><a class='btn' href='${forceHref}'>🔄 تلاش مجدد دستی</a></p>
      <p class='note'><a href='/'>← بازگشت به خانه</a></p>
    </div>
    <script>
      (function(){
        var auto = parseInt(new URLSearchParams(location.search).get('auto') || '0', 10);
        var waits = [20, 40, 60, 90]; // فاصله‌های فزاینده — قفل یوتیوب معمولاً ۱ تا ۲ دقیقه طول می‌کشد
        var note = document.getElementById('autoNote');
        if (auto >= waits.length) {
          if (note) note.textContent = 'هنوز نشد — لطفاً ۱ تا ۲ دقیقه صبر کنید و دوباره امتحان کنید.';
          return;
        }
        var s = waits[auto], el = document.getElementById('cnt'), at = document.getElementById('att');
        if (at) at.textContent = auto + 1;
        var t = setInterval(function(){
          s--; if (el) el.textContent = s;
          if (s <= 0) { clearInterval(t); location.href = ${JSON.stringify(freshHref)} + '&auto=' + (auto + 1); }
        }, 1000);
      })();
    </script>
  `, 200);
}

// ─── انتظار روی سرور برای باز شدن قفل ───
// چند تلاش با فاصله، داخل همان درخواست؛ کاربر فقط یک بار صفحه را باز می‌کند
// (محدودیت Workers: تعداد subrequest محدود است، پس فقط چند تلاش کم)
async function waitForUnlock(v, colo, player) {
  const waits = [15000, 25000]; // ms
  for (const ms of waits) {
    await new Promise(r => setTimeout(r, ms));
    try {
      const p = await getPlayer(v, true, true, colo);
      if (p.playabilityStatus && p.playabilityStatus.status === "OK") return p;
      player = p;
    } catch (e) { /* ادامه */ }
  }
  return player;
}


function subsUI(vidExpr) {
  // نوار زیرنویس فارسی زیر پخش‌کننده (نیازی به منوی CC مرورگر نیست)
  return `
    <div style="display:flex;gap:8px;align-items:center;margin:10px 0">
      <button id="subbtn" class="chip" type="button" style="cursor:pointer">زیرنویس فارسی ○ خاموش</button>
    </div>
    <div id="fasub" style="display:none;min-height:44px;text-align:center;font-size:17px;line-height:1.9;color:#fff;background:#141414;border-radius:12px;padding:8px 12px;margin-bottom:10px"></div>
    <script>
    (function(){
      var vEl = document.querySelector('video');
      var box = document.getElementById('fasub');
      var btn = document.getElementById('subbtn');
      var NL = String.fromCharCode(10);
      var cues = null, cuesFor = '', on = false;
      function tm(x){ x = x.trim(); var p = x.split(':'); var sec = parseFloat(p.pop()); var mi = parseInt(p.pop() || '0', 10); var h = parseInt(p.pop() || '0', 10); return h*3600 + mi*60 + sec; }
      function parse(t){
        var out = [];
        t.split(NL + NL).forEach(function(b){
          var lines = b.split(NL), i = 0;
          for (; i < lines.length; i++) { if (lines[i].indexOf('-->') > -1) break; }
          if (i >= lines.length) return;
          var m = lines[i].split('-->');
          var txt = lines.slice(i+1).join(' ').trim();
          if (txt) out.push({ s: tm(m[0]), e: tm(m[1]), t: txt });
        });
        return out;
      }
      function load(){
        var id = ${vidExpr};
        if (!id) return;
        if (cuesFor === id && cues) return;
        cues = null; cuesFor = id; box.textContent = 'در حال آماده‌سازی زیرنویس…';
        fetch('/subs?v=' + encodeURIComponent(id)).then(function(r){ return r.text(); }).then(function(t){
          if (cuesFor !== id) return;
          cues = parse(t);
          box.textContent = cues.length ? '' : 'زیرنویسی برای این ویدیو پیدا نشد';
        }).catch(function(){ if (cuesFor === id) box.textContent = 'خطا در دریافت زیرنویس'; });
      }
      btn.onclick = function(){
        on = !on;
        btn.textContent = 'زیرنویس فارسی ' + (on ? '● روشن' : '○ خاموش');
        box.style.display = on ? 'block' : 'none';
        if (on) load();
      };
      if (vEl) vEl.addEventListener('timeupdate', function(){
        if (!on || !cues) return;
        var ct = vEl.currentTime, txt = '';
        for (var i = 0; i < cues.length; i++) { if (ct >= cues[i].s && ct <= cues[i].e) { txt = cues[i].t; break; } }
        if (box.getAttribute('data-cur') !== txt) { box.setAttribute('data-cur', txt); box.textContent = txt; }
      });
      window.__subsLoad = load;
      window.__subsOn = function(){ return on; };
    })();
    </script>`;
}




// ─── سمینار شخصی: ساخت آزمون از روی زیرنویس با مدل AI خود کاربر ───
function fmtClock(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return m + ":" + (s < 10 ? "0" : "") + s;
}

function buildTranscript(cues) {
  let out = "";
  let last = -1;
  for (const c of cues) {
    const bucket = Math.floor(c.start / 30000);
    if (bucket !== last) { out += "\n[" + fmtClock(c.start / 1000) + "] "; last = bucket; }
    out += c.text + " ";
    if (out.length > 11000) break;
  }
  return out;
}

async function llmJson(cfg, sys, user) {
  const r = await fetch(normBase(cfg.base) + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.key },
    body: JSON.stringify({ model: cfg.model, temperature: 0.3, messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ] }),
  });
  if (!r.ok) throw new Error("llm " + r.status);
  const j = await r.json();
  return (((j.choices || [])[0] || {}).message || {}).content || "";
}

function jsonResp(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

async function handleQuiz(url) {
  const v = (url.searchParams.get("v") || "").trim();
  if (!/^[\w-]{6,20}$/.test(v)) return jsonResp({ error: "شناسهٔ ویدیو معتبر نیست" }, 400);
  const key = "quiz:" + v;
  if (KV) { try { const c = await KV.get(key, { type: "json" }); if (c) return jsonResp(c); } catch (e) {} }
  const cfg = await getAICfg();
  if (!(cfg && cfg.base && cfg.key && cfg.model)) {
    return jsonResp({ error: "برای ساخت آزمون، اول کلید AI را در /settings ذخیره کن." }, 503);
  }
  const got = await getCueList(v);
  if (got.status || !got.cues || !got.cues.length) return jsonResp({ error: "زیرنویسی برای این ویدیو پیدا نشد." }, 404);
  const transcript = buildTranscript(got.cues);
  const sys = "You create multiple-choice comprehension questions from a video transcript. Questions and options must be in Persian. Return ONLY a JSON array of 5 objects, each: {\"q\": string, \"options\": [4 strings], \"answer\": index 0-3 of the correct option, \"t\": the time in seconds of the relevant moment, taken from the [m:ss] markers in the transcript}. Only ask about facts stated in the transcript.";
  let raw = "";
  try { raw = await llmJson(cfg, sys, "Transcript:\n" + transcript); }
  catch (e) { return jsonResp({ error: "مدل AI جواب نداد: " + e.message }, 502); }
  let arr = [];
  try { const m = raw.match(/\[[\s\S]*\]/); arr = JSON.parse(m ? m[0] : raw); } catch (e) { arr = []; }
  const questions = (Array.isArray(arr) ? arr : []).filter(x =>
    x && typeof x.q === "string" && Array.isArray(x.options) && x.options.length === 4 &&
    x.options.every(o => typeof o === "string") && Number.isInteger(x.answer) && x.answer >= 0 && x.answer <= 3
  ).map(x => ({ q: x.q, options: x.options, answer: x.answer, t: typeof x.t === "number" ? Math.max(0, Math.floor(x.t)) : undefined }));
  if (!questions.length) return jsonResp({ error: "مدل آزمون معتبر نساخت؛ دوباره امتحان کن." }, 502);
  const out = { questions };
  if (KV) { try { await KV.put(key, JSON.stringify(out), { expirationTtl: 7 * 24 * 3600 }); } catch (e) {} }
  return jsonResp(out);
}


// ─── دوبلهٔ فارسی: تبدیل متن به صدا با سرویس AI خود کاربر ───
async function handleTts(request) {
  if (request.method !== "POST") return jsonResp({ error: "POST لازم است" }, 405);
  const cfg = await getAICfg();
  if (!(cfg && cfg.base && cfg.key)) return jsonResp({ error: "برای دوبله، اول کلید AI را در /settings ذخیره کن." }, 503);
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) return jsonResp({ error: "متن خالی است" }, 400);
  const r = await fetch(normBase(cfg.base) + "/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.key },
    body: JSON.stringify({ model: cfg.ttsModel || "tts-1", voice: "alloy", input: text, response_format: "mp3" }),
  });
  if (!r.ok) return jsonResp({ error: "سرویس صدا جواب نداد (" + r.status + ")" }, 502);
  return new Response(r.body, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
}

// ─── PWA: نصب روی گوشی، اشتراک‌گذاری از اپ یوتیوب، کش آفلاین ───
const ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="110" fill="#06060a"/><rect x="60" y="120" width="392" height="272" rx="60" fill="#ff2d55"/><path d="M215 190v132l110-66z" fill="#fff"/></svg>';

function manifestResp() {
  const m = {
    name: "یوتیوب لایت", short_name: "یوتیوب لایت", lang: "fa", dir: "rtl",
    start_url: "/", scope: "/", display: "standalone",
    background_color: "#06060a", theme_color: "#ff2d55",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
    share_target: { action: "/share", method: "GET", params: { title: "title", text: "text", url: "url" } },
  };
  return new Response(JSON.stringify(m), { headers: { "content-type": "application/manifest+json; charset=utf-8", "cache-control": "public, max-age=3600" } });
}

const SW_JS = [
  'const CACHE = "yt-lite-v1";',
  'self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/icon.svg"])).catch(() => {})); });',
  'self.addEventListener("activate", (e) => { e.waitUntil(self.clients.claim()); });',
  'self.addEventListener("fetch", (e) => {',
  '  const u = new URL(e.request.url);',
  '  if (e.request.method !== "GET" || u.origin !== location.origin) return;',
  '  if (u.pathname === "/subs") {',
  '    e.respondWith(caches.open(CACHE).then(async (c) => {',
  '      const hit = await c.match(e.request);',
  '      const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => null);',
  '      return hit || (await net) || new Response("WEBVTT", { headers: { "content-type": "text/vtt" } });',
  '    }));',
  '    return;',
  '  }',
  '  if (["/", "/search", "/settings", "/setup"].includes(u.pathname)) {',
  '    e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request)));',
  '  }',
  '});',
].join("\n");

function swResp() {
  return new Response(SW_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache" } });
}

function handleShare(url) {
  const raw = [url.searchParams.get("url"), url.searchParams.get("text"), url.searchParams.get("title")].filter(Boolean).join(" ");
  const m = raw.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
  if (m) return Response.redirect(new URL("/watch?v=" + m[1], url), 302);
  const q = raw.trim();
  if (q) return Response.redirect(new URL("/search?q=" + encodeURIComponent(q), url), 302);
  return Response.redirect(new URL("/", url), 302);
}

const PWA_HEAD = '<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#ff2d55"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icon.svg"><script>if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js");</script>';

// ─── تنظیمات ترجمه: URL + کلید + مدل (فقط با توکن مدیر) ───
let ADMIN_TOKEN = "";
function settingsForm(token, base, models, model, msg, ttsModel) {
  const opts = (models || []).map(m => '<option value="' + esc(m) + '"' + (m === model ? ' selected' : '') + '>' + esc(m) + '</option>').join("");
  return htmlPage("تنظیمات ترجمه", `
    <div class="center" style="padding-top:20px;text-align:right;max-width:560px;margin:0 auto">
      <h2 style="font-size:20px;margin-bottom:6px">تنظیمات ترجمهٔ زیرنویس</h2>
      <p class="note">اگه کلید ندی، ترجمه با مدل داخلی Cloudflare انجام می‌شه. کلید فقط توی KV همین Worker خودت ذخیره می‌شه.</p>
      ${msg ? `<p class="note" style="color:#8ab4f8">${esc(msg)}</p>` : ""}
      <form method="post" action="/settings" style="display:flex;flex-direction:column;gap:10px;margin-top:14px">
        <label>توکن مدیر<input type="password" name="token" value="${esc(token)}" required></label>
        <label>آدرس API (مثلاً https://api.openai.com/v1)<input type="text" name="base" value="${esc(base)}"></label>
        <label>کلید API<input type="password" name="key" placeholder="کلید جدید (خالی = همان قبلی)"></label>
        <button name="action" value="models" type="submit">دریافت لیست مدل‌ها و پیشنهاد بهترین مدل</button>
        <label>مدل صدا (TTS، اختیاری، پیش‌فرض tts-1)<input type="text" name="ttsModel" value="${esc(ttsModel || "")}" placeholder="tts-1"></label>
        <label>مدل<select name="model">${opts || `<option value="${esc(model || "")}">${esc(model || "— اول لیست را بگیر —")}</option>`}</select></label>
        <button name="action" value="save" type="submit">ذخیره</button>
      </form>
      <p class="note" style="margin-top:14px"><a href="/">← خانه</a></p>
    </div>`);
}
function pickBestModel(ids) {
  const prefs = [/gpt-4\.1|gpt-4o|gpt-5/i, /claude-(opus|sonnet)/i, /gemini-.*pro/i, /deepseek-(v|r)\d/i, /qwen|llama|mistral/i];
  for (const re of prefs) { const hit = ids.find(x => re.test(x)); if (hit) return hit; }
  return ids[0] || "";
}
async function handleSettings(request, url) {
  if (!ADMIN_TOKEN) return htmlPage("تنظیمات", `<div class="panel" style="max-width:640px;margin:20px auto;text-align:right">
    <b>توکن مدیر هنوز تنظیم نشده</b>
    <p class="note" style="margin-top:8px;line-height:2">برای فعال شدن این صفحه، یک Secret به نام <code>ADMIN_TOKEN</code> به ورکرت اضافه کن: داشبورد کلودفلر ← Workers &amp; Pages ← ورکرت ← Settings ← Variables and Secrets ← Add ← نوع Secret.</p>
    <p class="note" style="margin-top:10px"><a class="btn" href="/setup#admin">راهنمای قدم‌به‌قدم</a></p>
  </div>`, 503);
  if (!KV) return htmlPage("تنظیمات", "<p class='center'>کش KV تنظیم نشده است.</p>", 503);
  const f = {};
  if (request.method === "POST") { const fd = await request.formData(); fd.forEach((v, k) => { f[k] = String(v); }); }
  else { url.searchParams.forEach((v, k) => { f[k] = v; }); }
  const token = (f.token || "").trim();
  if (!token) return settingsForm("", "", [], "", "");
  if (token !== ADMIN_TOKEN) return settingsForm("", "", [], "", "توکن اشتباه است");
  const cur = (await getAICfg()) || {};
  const base = (f.base || cur.base || "").trim();
  const key = (f.key || "").trim() || cur.key || "";
  if (f.action === "save") {
    const model = (f.model || "").trim();
    const ttsModel = (f.ttsModel || "").trim();
    await KV.put("cfg:ai", JSON.stringify({ base: normBase(base), key, model, ttsModel }));
    return settingsForm(token, base, model ? [model] : [], model, "ذخیره شد ✅", ttsModel);
  }
  if (f.action === "models") {
    try {
      const r = await fetch(normBase(base) + "/models", { headers: { "Authorization": "Bearer " + key } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      const ids = ((j.data || j.models || [])).map(x => String(x.id || x.name || "")).filter(Boolean);
      const best = pickBestModel(ids);
      return settingsForm(token, base, ids, best, "پیشنهاد: " + best + " — اگه خواستی عوضش کن و ذخیره کن");
    } catch (e) {
      return settingsForm(token, base, [], "", "دریافت مدل‌ها ناموفق بود: " + e.message);
    }
  }
  return settingsForm(token, base, [], cur.model || "", "");
}

// ─── صفحه تماشا ───
// صفحهٔ پوسته: فوراً باز می‌شود و بعد صفحهٔ واقعی ویدیو را می‌گیرد (تا وقتی سرور منتظر قفل است، صفحه خالی نمی‌ماند)
function watchShell(url) {
  const qs = url.search ? url.search + "&raw=1" : "?raw=1";
  return new Response(`<!DOCTYPE html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#ff2d55"><link rel="icon" href="/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/icon.svg"><script>if("serviceWorker" in navigator)navigator.serviceWorker.register("/sw.js");</script><title>در حال باز کردن — یوتیوب لایت</title>
<style>
body{margin:0;background:#0f0f0f;color:#f1f1f1;font-family:Tahoma,system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:20px}
.spin{width:44px;height:44px;border:4px solid #333;border-top-color:#ff0033;border-radius:50%;animation:s 0.9s linear infinite;margin-bottom:18px}
@keyframes s{to{transform:rotate(360deg)}}
a{color:#ff4d5e}
.qnav{display:flex;gap:8px;overflow-x:auto;padding:8px 16px;border-bottom:1px solid #272727;background:#0f0f0f}
.qnav a{white-space:nowrap;background:#1f1f1f;border:1px solid #333;border-radius:20px;padding:6px 14px;color:#ddd;font-size:13px}
.qnav a:hover{border-color:#ff0033;color:#fff;text-decoration:none}
</style></head><body>
<div class="spin"></div>
<div id="m">در حال باز کردن ویدیو…</div>
<script>
(function(){
  fetch(location.pathname + ${JSON.stringify(qs)})
    .then(function(r){ return r.text(); })
    .then(function(t){ document.open(); document.write(t); document.close(); })
    .catch(function(){ document.getElementById('m').innerHTML = 'اتصال کند شد. <a href="' + location.href + '">دوباره امتحان کن</a>'; });
})();
</script>
</body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function handleWatch(request, url) {
  const v = url.searchParams.get("v");
  if (!v) return Response.redirect(new URL("/", url), 302);
  if (url.searchParams.get("raw") !== "1") return watchShell(url);
  const itag = url.searchParams.get("itag");
  const fresh = url.searchParams.get("fresh") === "1"; // تلاش خودکار: کش حافظه رد می‌شود، کش مشترک نه
  const force = url.searchParams.get("force") === "1"; // دکمهٔ دستی: یک تلاشِ کاملاً تازه
  const colo = (request.cf && request.cf.colo) || "?";
  let player;
  try {
    player = await getPlayer(v, fresh, force, colo);
    // اگر قفل بود، همین‌جا روی سرور چند بار با فاصله امتحان کن (کاربر لازم نیست دستی بزند)
    if (player.playabilityStatus && player.playabilityStatus.status !== "OK") {
      player = await waitForUnlock(v, colo, player);
    }
  } catch (e) {
    return htmlPage("خطا", `<p class='center'>خطا در دریافت اطلاعات ویدیو: ${esc(e.message)} — <a href='/'>خانه</a></p>`, 502);
  }
  const ps = player.playabilityStatus || {};
  const vd = player.videoDetails || {};
  if (ps.status && ps.status !== "OK") return lockedPage(v, itag, ps.reason || ps.status);
  const lists = allFormats(player);
  const pool = [...lists.progressive, ...lists.audio, ...lists.videoOnly];
  const active = (itag && pool.find(f => String(f.itag) === itag)) || lists.progressive[0] || lists.audio[0] || lists.videoOnly[0];
  if (!active) {
    return htmlPage("استریم موجود نیست", `<p class='center'>هیچ استریمی برای این ویدیو پیدا نشد. — <a href='/'>خانه</a></p>`, 200);
  }

  const chipList = [
    ...lists.progressive.map(f => ({ f, kind: "av" })),
    ...lists.audio.slice(0, 2).map(f => ({ f, kind: "audio" })),
    ...lists.videoOnly.slice(0, 4).map(f => ({ f, kind: "vo" })),
  ];
  const chips = chipList.map(({ f, kind }) => {
    const on = String(f.itag) === String(active.itag) ? " on" : "";
    return `<a class="chip${on}" href="/watch?v=${encodeURIComponent(v)}&itag=${f.itag}">${fmtLabel(f, kind)}</a>`;
  }).join("");

  const dlList = [
    ...lists.progressive.map(f => ({ f, kind: "av" })),
    ...lists.audio.map(f => ({ f, kind: "audio" })),
    ...lists.videoOnly.slice(0, 6).map(f => ({ f, kind: "vo" })),
  ];
  const downloads = dlList.map(({ f, kind }) =>
    `<a class="chip" href="/stream?v=${encodeURIComponent(v)}&itag=${f.itag}&download=1">⬇ ${fmtLabel(f, kind)}</a>`
  ).join("");

  const thumb = bestThumb(vd.thumbnail);
  const dur = fmtDuration(vd.lengthSeconds);

  return htmlPage(vd.title || v, `
    <video controls preload="metadata"${thumb ? ` poster="/img?u=${encodeURIComponent(thumb)}"` : ""} src="/stream?v=${encodeURIComponent(v)}&itag=${active.itag}" onerror="var d=document.getElementById('vfail');if(d)d.style.display='block'">></video>
    ${subsUI(JSON.stringify(v))}
    <div id="vfail" style="display:none;text-align:center;padding:26px 10px">
      <div style="font-size:34px">🤖</div>
      <p style="margin:8px 0 14px">پخش ویدیو با مشکل مواجه شد — احتمالاً قفل موقتی یوتیوب است یا اتصال استریم قطع شد.</p>
      <p><a class="btn" href="#" onclick="location.reload();return false">🔄 دوباره امتحان کن</a></p>
    </div>
    <h1 style="font-size:20px;margin:14px 0 4px">${esc(vd.title || "")}</h1>
    <div class="vsub">${esc(vd.author || "")}${dur ? " · " + esc(dur) : ""}</div>
    <p style="margin:12px 0"><a class="chip" href="/party?v=${encodeURIComponent(v)}">👥 تماشای همزمان با دوست</a></p>
    <h3 style="margin:18px 0 8px;font-size:15px;color:#aaa">کیفیت پخش</h3>
    <div class="chips">${chips}</div>
    <h3 style="margin:18px 0 8px;font-size:15px;color:#aaa">دانلود مستقیم</h3>
    <div class="chips">${downloads}</div>
    <p class="note">ویدیو مستقیم از سرورهای YouTube استریم می‌شود. کیفیت‌های «بدون صدا» فقط تصویر دارند؛ برای تماشا با صدا از نسخه 360p استفاده کنید.</p>
  `);
}

// ─── صفحه خانه ───
function homePage() {
  return htmlPage("خانه", `
    <style>.top form.search{display:none}</style>
    <div class="center">
      <div class="big">▶ یوتیوب لایت</div>
      <div class="sub">تماشای YouTube بدون تبلیغات، بدون صفحه رضایت و بدون ردیابی</div>
      <form class="search" action="/search" method="get" style="max-width:560px;margin:0 auto">
        <input type="text" name="q" placeholder="جستجو در YouTube..." autofocus>
        <button type="submit">جستجو</button>
      </form>
      <div class="note" style="margin-top:28px;line-height:2">
        🔍 جستجوی سریع · ▶ پخش مستقیم ویدیو (پیش‌فرض 360p با صدا)<br>
        🎧 حالت فقط‌صدا · ⬇ دانلود مستقیم با کیفیت‌های مختلف<br>
        🚫 بدون تبلیغات · 🚫 بدون ردیابی · 🚫 بدون نیاز به ورود<br>
      </div>
    </div>
    <div class="panel" style="max-width:640px;margin:36px auto 0;text-align:right">
      <b style="font-size:17px">🛠 سایت مال خودت رو بساز</b>
      <p class="note" style="margin:8px 0 14px">هر کس می‌تونه یه کپی شخصی از یوتیوب لایت روی حساب کلودفلر خودش داشته باشه. رایگانه، توکن، رمز یا کوکی لازم نیست جایی وارد کنی، و سایتت مال خودته.</p>
      <ol class="note" style="padding-inline-start:20px;line-height:2">
        <li>روی دکمهٔ زیر بزن و با حساب کلودفلرت وارد شو (اگه حساب نداری، رایگانه).</li>
        <li>اسم سایتت رو انتخاب کن و نصب رو تأیید کن.</li>
        <li>آدرس سایتت آماده‌ست؛ همون‌جا تنظیمات ترجمه رو هم داری.</li>
      </ol>
      <p style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
        <a class="btn" href="https://deploy.workers.cloudflare.com/?url=https://github.com/Alisarani7021/yt-lite" target="_blank" rel="noopener">⚡ نصب با یک کلیک</a>
        <a class="chip" href="/setup" style="align-self:center">راهنمای کامل</a>
      </p>
    </div>
  `);
}

// ─── قالب HTML ───
function setupPage() {
  return htmlPage("نصب روی حساب خودت", SETUP_HTML);
}

function htmlPage(title, body, status = 200) {
  const html = SHELL_HTML.replace("__TITLE__", () => esc(title) + " — یوتیوب لایت").replace("__BODY__", () => body);
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

// ─── ابزارهای کمکی ───
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function walk(o, fn) {
  if (!o || typeof o !== "object") return;
  if (Array.isArray(o)) { for (const v of o) walk(v, fn); return; }
  fn(o);
  for (const v of Object.values(o)) walk(v, fn);
}

function vTitle(v) {
  const t = v.title || {};
  return t.simpleText || (t.runs && t.runs[0] && t.runs[0].text) || "";
}
function vChannel(v) {
  const c = v.longBylineText || v.ownerText || {};
  return c.simpleText || (c.runs && c.runs[0] && c.runs[0].text) || "";
}
function vDuration(v) {
  return (v.lengthText && v.lengthText.simpleText) || "";
}
function vViews(v) {
  const c = v.viewCountText || v.shortViewCountText || {};
  return c.simpleText || (c.runs && c.runs[0] && c.runs[0].text) || "";
}
function vThumb(v) {
  const arr = v.thumbnail && v.thumbnail.thumbnails;
  if (!arr || !arr.length) return "";
  let best = arr[arr.length - 1];
  for (const t of arr) {
    if ((t.width || 0) <= 480 && (t.width || 0) >= (best.width || 0)) best = t;
  }
  return best.url || "";
}
function bestThumb(th) {
  const arr = th && th.thumbnails;
  if (!arr || !arr.length) return "";
  return arr[arr.length - 1].url || "";
}

function fmtLabel(f, kind) {
  const q = f.qualityLabel || (f.height ? f.height + "p" : "");
  if (kind === "audio") return "🎧 فقط صدا" + (q ? " · " + q : "");
  if (kind === "av") return "▶ " + (q || "پیش‌فرض") + " · تصویر+صدا";
  return "▶ " + (q || "?") + " · بدون صدا";
}

function fmtDuration(sec) {
  sec = parseInt(sec, 10);
  if (!sec || isNaN(sec)) return "";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function mimeExt(mime) {
  if (/video\/mp4/.test(mime || "")) return ".mp4";
  if (/video\/webm/.test(mime || "")) return ".webm";
  if (/audio\/mp4/.test(mime || "")) return ".m4a";
  if (/audio\/webm/.test(mime || "")) return ".webm";
  return ".bin";
}


// ═════════════════════════════════════════════════════════════
// زیرنویس فارسی (ترجمهٔ زنده با Workers AI) — /subs?v=ID
// ═════════════════════════════════════════════════════════════
let AI_BIND = null;
let ROOM_NS = null;

function vttTime(ms) {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000), x = ms % 1000;
  const p2 = (n, k = 2) => String(n).padStart(k, "0");
  return p2(h) + ":" + p2(m) + ":" + p2(s) + "." + p2(x, 3);
}

function vttResp(body, status = 200) {
  return new Response(body, { status, headers: {
    "content-type": "text/vtt; charset=utf-8",
    "cache-control": "public, max-age=3600",
    "access-control-allow-origin": "*",
  } });
}

async function translateBatch(lines) {
  // ترجمهٔ داخلی Workers AI (بدون کلید): خط‌ها موازی ترجمه می‌شوند
  return Promise.all(lines.map(async (line) => {
    try {
      const r = await AI_BIND.run("@cf/meta/m2m100-1.2b", { text: line, source_lang: "english", target_lang: "persian" });
      return (r && r.translated_text) ? String(r.translated_text).trim() : line;
    } catch (e) { return line; }
  }));
}

// ترجمه با مدل دلخواه کاربر (هر سرویس سازگار با OpenAI: URL + کلید + مدل)
function normBase(u) {
  return String(u || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
}
async function getAICfg() {
  if (!KV) return null;
  try { return (await KV.get("cfg:ai", { type: "json" })) || null; } catch (e) { return null; }
}
async function llmTranslate(cfg, lines) {
  const sys = "You translate English subtitle lines into natural, short Persian (Farsi). Return ONLY a JSON array of strings with exactly the same number of items, in the same order. No explanations.";
  const r = await fetch(normBase(cfg.base) + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + cfg.key },
    body: JSON.stringify({ model: cfg.model, temperature: 0.2, messages: [
      { role: "system", content: sys },
      { role: "user", content: JSON.stringify(lines) },
    ] }),
  });
  if (!r.ok) throw new Error("llm " + r.status);
  const j = await r.json();
  const txt = (((j.choices || [])[0] || {}).message || {}).content || "";
  const m = txt.match(/\[[\s\S]*\]/);
  const arr = JSON.parse(m ? m[0] : txt);
  if (!Array.isArray(arr) || arr.length !== lines.length) throw new Error("bad length");
  return arr.map((x, i) => String(x || lines[i]));
}

const SUB_CHUNK = 240;

async function getCueList(v) {
  const player = await getPlayer(v);
  const tracks = (((player.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks) || [];
  if (!tracks.length) return { status: 404 };
  const t = tracks.find(x => /^en/.test(x.languageCode)) || tracks[0];
  const r = await fetch(t.baseUrl);
  if (!r.ok) return { status: 502 };
  const xml = await r.text();
  const cues = [];
  const dec = (x) => x.replace(/<[^>]+>/g, "").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
  const re = /<p t="(\d+)" d="(\d+)"[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(xml))) {
    const text = dec(m[3]);
    if (!text) continue;
    const start = parseInt(m[1], 10), dur = parseInt(m[2], 10) || 2500;
    cues.push({ start, end: start + dur, text });
  }
  return { cues };
}

async function translateCues(cues, cfg, useLLM) {
  const size = useLLM ? 30 : 10;
  const batches = [];
  for (let i = 0; i < cues.length; i += size) batches.push(cues.slice(i, i + size).map(c => c.text));
  const results = await Promise.all(batches.map(async (lines) => {
    if (useLLM) { try { return await llmTranslate(cfg, lines); } catch (e) { /* کمکی */ } }
    try { return await translateBatch(lines); } catch (e) { return lines; }
  }));
  return [].concat(...results);
}

async function getChunk(v, i, cues, cfg, useLLM) {
  const key = "subchunk:" + v + ":" + i;
  if (KV) { try { const c = await KV.get(key, { type: "json" }); if (Array.isArray(c)) return c; } catch (e) {} }
  const part = cues.slice(i * SUB_CHUNK, (i + 1) * SUB_CHUNK);
  const tr = await translateCues(part, cfg, useLLM);
  if (KV && tr.length === part.length) { try { await KV.put(key, JSON.stringify(tr), { expirationTtl: 7 * 24 * 3600 }); } catch (e) {} }
  return tr;
}

function buildVtt(cues, texts) {
  let body = "WEBVTT\n\n";
  cues.forEach((c, i) => { body += vttTime(c.start) + " --> " + vttTime(c.end) + "\n" + (texts[i] || c.text) + "\n\n"; });
  return body;
}

async function handleSubs(url, ctx) {
  const v = (url.searchParams.get("v") || "").trim();
  if (!/^[\w-]{6,20}$/.test(v)) return vttResp("WEBVTT\n\n", 400);
  const key = "subfa:" + v;
  if (KV) {
    try { const c = await KV.get(key); if (c) return vttResp(c); } catch (e) {}
  }
  if (!AI_BIND) return vttResp("WEBVTT\n\n", 503);
  const got = await getCueList(v);
  if (got.status) return vttResp("WEBVTT\n\n", got.status);
  const cues = got.cues;
  if (!cues.length) return vttResp("WEBVTT\n\n", 404);
  const cfg = await getAICfg();
  const useLLM = !!(cfg && cfg.base && cfg.key && cfg.model);
  const n = Math.ceil(cues.length / SUB_CHUNK);

  // بخش اول همین الان ترجمه می‌شود تا پخش زود شروع شود
  const first = await getChunk(v, 0, cues, cfg, useLLM);

  // بقیه‌ی بخش‌ها در پس‌زمینه؛ قفل برای جلوگیری از اجرای تکراری
  if (n > 1 && ctx && KV) {
    let busy = false;
    try { busy = !!(await KV.get("subbusy:" + v)); } catch (e) {}
    if (!busy) {
      try { await KV.put("subbusy:" + v, "1", { expirationTtl: 900 }); } catch (e) {}
      ctx.waitUntil((async () => {
        try {
          for (let i = 1; i < n; i++) await getChunk(v, i, cues, cfg, useLLM);
          const all = [];
          for (let i = 0; i < n; i++) {
            const c = await KV.get("subchunk:" + v + ":" + i, { type: "json" });
            all.push(...(Array.isArray(c) ? c : cues.slice(i * SUB_CHUNK, (i + 1) * SUB_CHUNK).map(x => x.text)));
          }
          await KV.put(key, buildVtt(cues, all), { expirationTtl: 7 * 24 * 3600 });
        } finally {
          try { await KV.delete("subbusy:" + v); } catch (e) {}
        }
      })());
    }
  }

  // پاسخ فوری: بخش‌های آماده ترجمه‌شده، بقیه انگلیسی تا وقتی کامل شود
  const texts = [];
  for (let i = 0; i < n; i++) {
    let c = i === 0 ? first : null;
    if (!c && KV) { try { c = await KV.get("subchunk:" + v + ":" + i, { type: "json" }); } catch (e) {} }
    if (Array.isArray(c)) texts.push(...c);
    else texts.push(...cues.slice(i * SUB_CHUNK, (i + 1) * SUB_CHUNK).map(x => x.text));
  }
  return vttResp(buildVtt(cues, texts));
}

// ═════════════════════════════════════════════════════════════
// تماشای همزمان (watch party) — Durable Object + WebSocket
// ═════════════════════════════════════════════════════════════
export class Room {
  constructor(state) { this.state = state; }
  async fetch(request) {
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const k = new URL(request.url).searchParams.get("k") || "";
    let hk = await this.state.storage.get("hostKey");
    if (!hk && k) { await this.state.storage.put("hostKey", k); hk = k; }
    const role = (k && hk === k) ? "host" : "viewer";
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.state.acceptWebSocket(server, [role]);
    server.send(JSON.stringify({ type: "role", role }));
    const q = (await this.state.storage.get("q")) || [];
    server.send(JSON.stringify({ type: "queue", q }));
    const st = await this.state.storage.get("st");
    if (st) server.send(JSON.stringify({ type: "state", ...st }));
    return new Response(null, { status: 101, webSocket: client });
  }
  roleOf(ws) {
    const tags = this.state.getTags(ws) || [];
    return tags.includes("host") ? "host" : "viewer";
  }
  async broadcast(obj, except) {
    const out = JSON.stringify(obj);
    for (const c of this.state.getWebSockets()) {
      if (c !== except) { try { c.send(out); } catch (e) {} }
    }
  }
  async webSocketMessage(ws, msg) {
    let m;
    try { m = JSON.parse(msg); } catch (e) { return; }
    const isHost = this.roleOf(ws) === "host";
    const validId = (x) => /^[\w-]{6,20}$/.test(String(x || ""));

    if (m.type === "state") {
      if (!isHost) { try { ws.send(JSON.stringify({ type: "denied" })); } catch (e) {} return; }
      if (!validId(m.v)) return;
      const st = { v: String(m.v), t: Math.max(0, Number(m.t) || 0), playing: !!m.playing, at: Date.now() };
      await this.state.storage.put("st", st);
      await this.broadcast({ type: "state", ...st }, ws);
      return;
    }

    if (m.type === "queue_add") {
      if (!validId(m.v)) return;
      const q = (await this.state.storage.get("q")) || [];
      if (q.length >= 50) return;
      q.push(String(m.v));
      await this.state.storage.put("q", q);
      await this.broadcast({ type: "queue", q });
      return;
    }

    if (m.type === "queue_play" || m.type === "queue_remove") {
      if (!isHost) { try { ws.send(JSON.stringify({ type: "denied" })); } catch (e) {} return; }
      const q = (await this.state.storage.get("q")) || [];
      const i = Number(m.i);
      if (!Number.isInteger(i) || i < 0 || i >= q.length) return;
      const [v] = q.splice(i, 1);
      await this.state.storage.put("q", q);
      await this.broadcast({ type: "queue", q });
      if (m.type === "queue_play") {
        const st = { v, t: 0, playing: true, at: Date.now() };
        await this.state.storage.put("st", st);
        await this.broadcast({ type: "state", ...st });
      }
      return;
    }
  }
  async webSocketClose(ws) { try { ws.close(); } catch (e) {} }
  async webSocketError(ws) { try { ws.close(); } catch (e) {} }
}

const PARTY_HTML = PARTY_TEMPLATE;

function partyPage(url) {
  const v = (url.searchParams.get("v") || "").trim();
  const room = (url.searchParams.get("room") || "").trim();
  if (!room) {
    const id = Math.random().toString(36).slice(2, 10);
    const key = crypto.randomUUID().replace(/-/g, "");
    const q = (v ? "&v=" + encodeURIComponent(v) : "");
    return Response.redirect(new URL("/party?room=" + id + "&k=" + key + q, url), 302);
  }
  const roomName = room.replace(/[^\w-]/g, "").slice(0, 40);
  const vid = /^[\w-]{6,20}$/.test(v) ? v : "";
  const html = PARTY_HTML
    .replace("__SUBSUI__", () => subsUI("(window.__partyVid || '')"))
    .replace("__ROOM__", () => roomName)
    .replace("__VIDEO__", () => vid);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export default {
  async fetch(request, env, ctx) {
    if (env && env.YT_CACHE) KV = env.YT_CACHE; // کش مشترک (KV)
    if (env && env.YT_COOKIE) YT_COOKIE = env.YT_COOKIE; // کوکی حساب (secret)
    if (env && env.AI) AI_BIND = env.AI;
    if (env && env.ADMIN_TOKEN) ADMIN_TOKEN = env.ADMIN_TOKEN;
    if (env && env.ROOM) ROOM_NS = env.ROOM;
    const url = new URL(request.url);
    try {
      if (url.pathname === "/") return homePage();
      if (url.pathname === "/search") return handleSearch(url);
      if (url.pathname === "/channel") return handleChannel(url);
      if (url.pathname === "/subs") return handleSubs(url, ctx);
      if (url.pathname === "/manifest.webmanifest") return manifestResp();
      if (url.pathname === "/sw.js") return swResp();
      if (url.pathname === "/icon.svg") return new Response(ICON_SVG, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
      if (url.pathname === "/share") return handleShare(url);
      if (url.pathname === "/quiz") return handleQuiz(url);
      if (url.pathname === "/seminar") return htmlPage("سمینار شخصی", SEMINAR_BODY);
      if (url.pathname === "/tts") return handleTts(request);
      if (url.pathname === "/dub") return htmlPage("دوبلهٔ فارسی", DUB_BODY);
      if (url.pathname === "/settings") return handleSettings(request, url);
      if (url.pathname === "/setup") return setupPage();
      if (url.pathname === "/party") return partyPage(url);
      if (url.pathname.startsWith("/room/")) {
        if (!ROOM_NS) return new Response("room service not configured", { status: 503 });
        const name = decodeURIComponent(url.pathname.slice(6)).replace(/[^\w-]/g, "").slice(0, 40);
        return ROOM_NS.get(ROOM_NS.idFromName(name)).fetch(request);
      }
      if (url.pathname === "/watch") return handleWatch(request, url);
      if (url.pathname === "/stream") return handleStream(request, url);
      if (url.pathname === "/img") return handleImg(url);
      return htmlPage("پیدا نشد", "<p class='center'>صفحه پیدا نشد. <a href='/'>خانه</a></p>", 404);
    } catch (e) {
      return htmlPage("خطا", `<p class='center'>خطایی رخ داد: ${esc(e.message)} — <a href='/'>خانه</a></p>`, 500);
    }
  },
};
