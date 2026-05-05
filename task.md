# Tarefas - FarmaEntrega

- [x] Cópia física da pasta do projeto para backup (Farmaentrega 25_backup_20260429).
- [x] Iniciar servidor local (`npm run dev`).
- [x] Testar login e capturar erros no console.
    - [x] Identificado erro de permissão: `Missing or insufficient permissions` em `users/{uid}`.
    - [x] Identificado erro de login: `auth/invalid-credential` (Provedor de E-mail ativo).
- [x] Investigar causa da falha de permissão no Firestore mesmo com usuário logado.
    - [x] Descoberto que as regras precisam de deploy específico para o banco de dados do AI Studio.
- [x] Corrigir e realizar deploy das regras do Firestore.
- [x] Validar acesso do usuário Admin (Tiago Garcia).
- [x] Limpeza de código e restauração de segurança.
- [x] Sistema estabilizado e funcional!
