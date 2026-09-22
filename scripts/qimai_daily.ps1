# Daily local Qimai top-up — meant to be run by Windows Task Scheduler once a day.
#
# Qimai binds the login session to the IP it was created on, so this CANNOT run on GitHub's
# datacenter (the Action returns "NOT LOGGED IN"). It must run on the owner's own machine,
# on the same network where the cookie was captured. It fetches the rotating 3 games for the
# day, rebuilds data/qimai.json, and commits + pushes any new days.
#
# Cookie: put the full Qimai Cookie header string in scripts\.qimai_cookie (gitignored).
# Refresh it ~monthly (Qimai logins use a CAPTCHA). If it goes stale the fetch just logs
# "NOT LOGGED IN" and nothing is committed.
#
# Register (run once, in an elevated-or-normal PowerShell — adjust the time to taste):
#   schtasks /Create /TN "Qimai daily" /SC DAILY /ST 09:00 /F `
#     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\DevPrograms\gacha-tracker\scripts\qimai_daily.ps1"
# The machine must be awake at that time; a missed day is harmless — the next run backfills it.

$ErrorActionPreference = "Continue"
Set-Location "C:\DevPrograms\gacha-tracker"

python scripts\fetch_qimai_today.py
python scripts\build_qimai.py

git add data/qimai_daily data/qimai.json
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Write-Host "No new Qimai days."; exit 0 }

git commit -m "chore: Qimai revenue for $(Get-Date -Format yyyy-MM-dd)"
for ($i = 1; $i -le 3; $i++) {
    git pull --rebase origin main
    git push
    if ($LASTEXITCODE -eq 0) { exit 0 }
    Write-Host "push attempt $i lost a race; retrying"
    Start-Sleep 5
}
Write-Error "could not push after 3 attempts"
exit 1
