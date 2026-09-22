@echo off
REM ============================================================================
REM  Qimai daily fetch — double-click this once a day.
REM  Opens a window with two cookie fields (one per Qimai account):
REM    Cookie 1  ->  genshin / hsr / zzz   (HoYo)
REM    Cookie 2  ->  wuwa / endfield / nte
REM  Runs both, rebuilds data\qimai.json, and pushes any new days. The fields
REM  pre-fill with the last cookies you used; if one has expired the log says
REM  which, so you can paste a fresh string and hit Run again.
REM
REM  Must run from your own machine/network — Qimai binds each session to the
REM  login IP, so this cannot run on GitHub's servers.
REM ============================================================================
cd /d "%~dp0"
python scripts\qimai_gui.py
if errorlevel 1 (
    echo(
    echo The fetch window failed to start -- see the error above.
    pause
)
