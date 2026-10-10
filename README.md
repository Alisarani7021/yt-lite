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

## تنظیم ترجمهٔ AI (اختیاری)
بعد از نصب، آدرس `/settings` را باز کن، آدرس API سرویس سازگار با OpenAI، کلید و مدل را وارد کن. توکن مدیر را از Secret با نام `ADMIN_TOKEN` بگذار:

```bash
npx wrangler secret put ADMIN_TOKEN
```

## امکانات
- جستجو، پخش مستقیم، صفحهٔ کانال (با تب Videos و Shorts)
- زیرنویس فارسی زنده
- تماشای همزمان با دوستان (لینک اتاق)
