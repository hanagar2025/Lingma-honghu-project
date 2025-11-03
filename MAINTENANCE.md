MAINTENANCE

This file documents how to recover archived pages and how to import the Taro Alipay project into DevTools.

1) Restore archived native mini pages

If you moved the original `pages` into `archive/old-mini-pages` and need to restore:

```bash
mv archive/old-mini-pages pages
```

2) How to open Taro Alipay project in Alipay DevTools

- Build the project (or run dev watch):

```bash
cd frontend/honghu-alipay
npm run dev:alipay   # watch mode
# or
npm run build:alipay # one-time build to dist
```

- In Alipay DevTools: File → Open Project → choose `frontend/honghu-alipay/dist` (or open `frontend/honghu-alipay` and select Alipay platform). Ensure the project path matches the compiled output.

3) Notes
- The `archive/` directory is ignored by git by default. To preserve archives in git, remove the ignore entry and commit.
- If you accidentally add `pages` or `app.json` to repo root in future, update README to point to `frontend/honghu-alipay`.
