---
status: complete
date: 2026-06-11
---

# Summary

Removed unsupported `review-automated` keys from `.github/dependabot.yml` so GitHub can validate the Dependabot v2 configuration on PR #291.

## Verification

- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npx prettier --check .github/dependabot.yml .planning/quick/260611-85f-fix-pr-291-dependabot-config-by-removing/PLAN.md`
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/node -e "const fs=require('fs'); const yaml=require('js-yaml'); yaml.load(fs.readFileSync('.github/dependabot.yml','utf8')); console.log('dependabot.yml parsed')"`
- `rg -n "review-automated" .github/dependabot.yml`
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm run lint`
- `PATH=/opt/homebrew/bin:$PATH /opt/homebrew/bin/npm test`
