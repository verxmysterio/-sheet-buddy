@echo off
cd /d "C:\Users\aakas\OneDrive\Desktop\BALANCE SHEET BUDDY"

powershell -NoExit -Command "$env:PYTHONPATH='backend'; uvicorn app.main:app --reload --port 8000"

pause