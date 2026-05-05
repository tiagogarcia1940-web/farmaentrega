# 🚀 FarmaEntrega - Sistema de Entrega de Medicamentos

Sistema completo de entrega de medicamentos em tempo real com 3 portais: Cliente, Farmácia e Logística/Motoboy.

## ✨ Funcionalidades

### 👥 Portal Cliente
- 🔍 Busca e catálogo de medicamentos
- 🛒 Carrinho e checkout
- 💳 Múltiplos métodos de pagamento (Dinheiro, Cartão, PIX)
- 📍 Rastreamento em tempo real com mapa
- 🔔 Notificações em tempo real
- 📱 PWA instalável (funciona offline)

### 💊 Portal Farmácia
- 📊 Dashboard com KPIs e gráficos
- 📦 Gerenciar estoque e produtos
- 📥 Import em massa de produtos (CSV)
- 📋 Gerenciar pedidos (status, filtros, histórico)
- 👥 Gerenciar motoboys
- 📈 Relatórios e analytics
- 💬 Integração WhatsApp

### 🏍️ Portal Motoboy
- 📍 GPS em tempo real
- 📋 Lista de entregas otimizada
- 📸 Prova de entrega (foto + assinatura)
- 🗺️ Navegação integrada
- 💰 Histórico de entregas
- ⭐ Avaliações

## 🚀 Começar Rápido

### Localmente
```bash
npm install
npm run dev
```

Acesse: http://localhost:3000

### Deploy (Vercel - Recomendado)
```bash
git push origin main
# Vercel faz deploy automático
```

## 📱 PWA (Instalar como App)

- **Chrome:** Clique no ícone de instalação
- **Firefox:** Menu > Instalar aplicativo
- **iPhone:** Share > Add to Home Screen
- **Android:** Menu > Instalar aplicativo

## 📊 Import de Estoque (CSV)

1. Baixar template CSV no painel
2. Preencher no Excel com: name, category, price, quantity
3. Salvar como CSV UTF-8
4. Upload na plataforma
5. Pronto! Produtos importados

## 🌍 Deploy em Produção

Veja [GUIA_PWA_E_IMPORTACAO.md](GUIA_PWA_E_IMPORTACAO.md) para instruções completas.

### Vercel (Fácil - 5 min)
1. Repositório no GitHub
2. https://vercel.com > New Project
3. Selecione repositório
4. Deploy automático

### Firebase Hosting
```bash
firebase login
firebase deploy --only hosting
```

## 🔐 Segurança

- ✅ HTTPS em produção
- ✅ Firestore rules (isolamento por farmácia)
- ✅ Autenticação Firebase
- ✅ Rate limiting
- ✅ Validação de entrada
- ✅ Conformidade LGPD

## 🛠️ Stack

- **Frontend:** React 19 + Vite + Tailwind CSS
- **Backend:** Express.js (Node.js)
- **Database:** Firebase Firestore
- **Auth:** Firebase Authentication
- **Maps:** Leaflet + OpenStreetMap
- **PWA:** Vite Plugin PWA + Workbox

## 📝 Variáveis de Ambiente

```
VITE_FIREBASE_PROJECT=gen-lang-client-0221522158
GEMINI_API_KEY=sua_chave_aqui (opcional)
```

## 📞 Suporte

- **Email:** suporte@farmaentrega.com.br
- **Chat:** Disponível no app

---

**FarmaEntrega - Medicamentos entregues com segurança e rapidez** 🏥🏍️
