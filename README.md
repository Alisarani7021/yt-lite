# یوتیوب لایت

تماشای YouTube بدون تبلیغات، بدون صفحه رضایت و بدون ردیابی، روی Cloudflare Workers. رایگان.

## نصب با یک کلیک

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Alisarani7021/yt-lite)

روی دکمه بزن، با حساب کلودفلر خودت وارد شو و نصب کن. توکن یا رمزی جایی وارد نمی‌شود.

## نصب با ترمینال

```bash
git clone https://github.com/Alisarani7021/yt-lite
cd yt-lite
npm install
export CLOUDFLARE_API_TOKEN=توکن_خودت   # فقط روی کامپیوتر خودت
npx wrangler kv namespace create YT_CACHE   # id خروجی را در wrangler.toml بگذار
npx wrangler deploy
```

## تنظیم ترجمهٔ AI (اختیاری ولی توصیه‌شده)
1. یه رمز تصادفی بساز (حداقل ۱۶ کاراکتر) و جایی یادداشتش کن؛ این «توکن مدیر» توئه.
2. داشبورد کلودفلر ← Workers & Pages ← ورکرت ← **Settings** ← **Variables and Secrets** ← **Add**، نوع **Secret**، اسم `ADMIN_TOKEN` و رمزت رو بذار. ذخیره کن.
3. آدرس `/settings` سایتت رو باز کن، توکن مدیر و آدرس API، کلید و مدل رو وارد کن و ذخیره کن.

(همین مراحل توی `/setup#admin` هم هست.)

## امکانات
- جستجو، پخش مستقیم، صفحهٔ کانال (با تب Videos و Shorts)
- زیرنویس فارسی زنده
- تماشای همزمان با دوستان (لینک اتاق)
