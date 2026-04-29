---
status: complete
task_id: "260429-c3m"
description: "add ADMIN_PASSWORD env support to seed"
date: "2026-04-29"
---

# Quick Task 260429-c3m: add ADMIN_PASSWORD env support to seed

## Summary

Updated `src/lib/seed.ts` to read `ADMIN_PASSWORD` from env vars. Falls back to `'admin'` if not set. Removed password value from seed log message for security.

## Changes

- `src/lib/seed.ts`: `process.env.ADMIN_PASSWORD || 'admin'` instead of hardcoded `'admin'`; removed credential logging

## Notes

- `.env` files were permission-denied — could not create `.env.example` automatically
- User should add `ADMIN_PASSWORD=your-secure-password` to `.env` if desired
