@echo off
echo Iniciando deploy das regras do Firestore...
npx firebase-tools deploy --only firestore:rules --project gen-lang-client-0221522158
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Ocorreu um erro no deploy. 
    echo Verifique se voce tem o Firebase CLI instalado (npm install -g firebase-tools) 
    echo e se ja fez o login (firebase login).
) else (
    echo.
    echo Deploy concluido com sucesso!
)
pause
