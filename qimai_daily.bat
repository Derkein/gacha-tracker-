@echo off
REM ============================================================================
REM  Qimai daily top-up — double-click this once a day.
REM  Fetches the day's rotating 3 games (China-iPhone revenue) from Qimai,
REM  rebuilds data\qimai.json, and pushes ONLY if there are new days.
REM
REM  Cookie: reads scripts\.qimai_cookie (gitignored). Refresh it ~monthly by
REM  pasting a fresh Qimai Cookie header into that file. If it goes stale the
REM  fetch just prints "NOT LOGGED IN" and nothing is committed.
REM
REM  Must run from your own machine/network — Qimai binds the session to the
REM  login IP, so this cannot run on GitHub's servers.
REM ============================================================================
cd /d "%~dp0"

echo(
echo === Fetching Qimai revenue ===
python scripts\fetch_qimai_today.py

echo(
echo === Rebuilding data\qimai.json ===
python scripts\build_qimai.py

git add data/qimai_daily data/qimai.json
git diff --cached --quiet
if %errorlevel%==0 (
    echo(
    echo No new Qimai days -- nothing to push.
    goto :done
)

for /f %%d in ('python -c "import datetime;print(datetime.date.today())"') do set "TODAY=%%d"
echo(
echo === New days found -- committing and pushing ===
git commit -m "chore: Qimai revenue for %TODAY%"
git pull --rebase origin main
git push

:done
echo(
echo Done.
pause
