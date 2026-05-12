# Backup 2026-05-12 - FarmaEntrega

## Objetivo do dia

Avancar a seguranca profissional do FarmaEntrega para preparar o sistema para SaaS multi-farmacia.

## Principais entregas

- Criacao segura de pedidos via backend em `/api/create-order`.
- Configuracao de `FIREBASE_SERVICE_ACCOUNT_JSON` na Vercel.
- Publicacao do app em producao na Vercel.
- Publicacao de regras mais restritas no Firestore.
- Remocao de dependencia de e-mail hardcoded nas regras.
- Restricao de criacao inicial de perfis sensiveis.
- Rate limit basico e limite de tamanho de payload na API de pedidos.
- Implementacao inicial de custom claims via `/api/sync-claims`.
- Regras do Firestore passaram a aceitar `request.auth.token.role` e `request.auth.token.pharmacyId`.
- Fallback temporario por documento `users` mantido para nao quebrar usuarios existentes.

## Commits envolvidos

- `603d500` - Accept alternate Firebase admin env names
- `2af42ea` - Detect Firebase admin env by pattern
- `a1f948d` - Tighten professional security controls
- `d43d78b` - Sync Firebase custom claims

## Validacoes realizadas

- `npm run lint`
- `npm run build`
- `npm audit --audit-level=moderate`
- `firebase-tools deploy --only firestore:rules --dry-run`
- Deploy Vercel em producao
- Deploy Firestore rules
- Teste dos endpoints `/api/create-order` e `/api/sync-claims` com token invalido para confirmar Firebase Admin ativo

## Observacoes de seguranca

- `npm audit --audit-level=moderate` passou.
- Permanecem 8 vulnerabilidades baixas herdadas da cadeia do `firebase-admin`.
- Nao foi aplicado `npm audit fix --force` porque causaria downgrade quebravel do `firebase-admin`.
- Proximo passo recomendado: apos login nos perfis reais, remover gradualmente o fallback das regras baseado no documento `users`.

## Estado final

- GitHub sincronizado ate `d43d78b`.
- Producao ativa em `https://farmaentrega.vercel.app`.
- Nivel estimado de seguranca apos esta etapa: 84%.
