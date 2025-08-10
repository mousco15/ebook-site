# Site d'Ebooks (MVP local) — Admin + Auth + Édition

- Backend : Express + SQLite + Sessions
- Frontend : HTML + JS (Pico.css)
- Fichiers : `uploads/`

## 1) Démarrer en local
```bash
npm install
npm start
```
- http://localhost:3000/login.html (admin)
- http://localhost:3000 (publiques)

Identifiants par défaut : `admin@example.com` / `admin123`  
Change via `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `SESSION_SECRET`.

## 2) Ajouter / Modifier / Supprimer
- **/admin.html** : Ajouter un livre (PDF obligatoire, couverture optionnelle).
- Clique **Modifier** sur un livre pour éditer les métadonnées et remplacer les fichiers.
- Clique **Supprimer** pour retirer un livre (les fichiers sont supprimés du disque).

## 3) Arborescence
- `uploads/covers/` — images de couverture
- `uploads/pdfs/` — fichiers PDF
- `data.sqlite` — base de données

## 4) Déploiement rapide (VPS)
- `pm2 start server.js` + Nginx reverse proxy.

## 5) Étapes suivantes
- Stripe Checkout + liens de téléchargement protégés
- Auth utilisateurs (acheteurs), reçus, factures
- Moteur de recherche avancé (Meilisearch)
