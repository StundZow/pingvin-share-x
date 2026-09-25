# StundTransfer

Fork de [Pingvin Share X](https://github.com/smp46/pingvin-share-x) transformé en outil de **dépôt de rushs** : la personne dit qui elle est et pour quelle vidéo, dépose ses fichiers ou dossiers, et ils arrivent directement dans `<dossier de réception>/<Nom> - <Vidéo>/` sur le NAS. Aucun compte, aucun lien de partage, aucune page de téléchargement.

- Branche de travail : `stundtransfer` (partie de la version officielle **v1.22.3**)
- Image Docker : `ghcr.io/stundzow/stundtransfer:latest`, construite par GitHub Actions à chaque envoi sur la branche `stundtransfer` (`.github/workflows/stundtransfer-image.yml`). Les tests tournent avant : si un test échoue, l'image n'est pas publiée.
- Le partage « classique » de Pingvin (toi → quelqu'un) fonctionne comme avant.

## Comment ça marche

| Qui | Où | Ce qu'il voit |
|---|---|---|
| Visiteur | `https://stundtransfer.synology.me/` | La page de dépôt directement (si **Dépôt public** est activé), une icône « personne » en haut à droite pour se connecter |
| Visiteur | lien de dépôt `…/upload/<jeton>` | La page de dépôt de ce lien |
| Admin (connecté) | **Administration → Dépôts reçus** (ou menu liens) | **Tous** les dépôts : qui, quelle vidéo, quand, nombre de fichiers, taille, statut, détail fichier par fichier, « Réessayer le rangement » en cas d'erreur |
| Admin (connecté) | **Administration → Paramètres** | Tous les réglages : section **StundTransfer**, nom de l'appli et logo (Général), couleurs (Apparence), etc. |

- Le **dépôt public** (accueil) ne demande aucun lien. Les **liens de dépôt** (« partages inversés » de Pingvin) restent possibles en plus, par exemple pour une personne précise avec une expiration, une taille max et un nombre d'utilisations max.
- L'envoi se fait par morceaux (Paramètres → Partage → taille des morceaux, 20 Mo), plusieurs en parallèle, avec reprise automatique en cas de coupure et reprise après rafraîchissement de la page (il suffit de redéposer les mêmes fichiers).
- Pendant l'envoi, les morceaux sont écrits dans un dossier « en cours » **sur le même dossier partagé** que la destination : à la fin, le rangement est un simple renommage (instantané, jamais de doublon). Si ce n'est pas possible (autre disque), le serveur copie → vérifie la taille → supprime l'original, et l'affiche dans ses journaux.
- Noms nettoyés (caractères interdits Windows/Synology, `..`, chemins absolus, espaces), arborescence des dossiers conservée, jamais d'écrasement (` (2)`, ` (3)`…), dossier réutilisé si `Nom - Vidéo` existe déjà (même avec une autre casse), date de modification d'origine conservée.
- Les envois abandonnés sont supprimés du dossier « en cours » après le délai choisi (3 jours par défaut).

## Réglages

**Dans l'interface** (Administration → Paramètres → **StundTransfer**), modifiables à chaud, sans redémarrage :

| Réglage | Défaut | Rôle |
|---|---|---|
| Dépôt public | désactivé | L'accueil accepte les dépôts sans compte ni lien |
| Taille maximale par dépôt | 500 Go | Pour le dépôt public (les liens de dépôt gardent leur propre limite) |
| Morceaux envoyés en même temps | 6 | Par navigateur (1 à 16) |
| Espace à garder libre | 20 Go | Refuse un dépôt qui laisserait moins d'espace libre |
| Supprimer les envois inachevés après | 3 jours | Nettoyage du dossier « en cours » |

Le nom affiché en haut et le logo se changent dans **Paramètres → Général**.

**Dans le `compose.yaml`** (liés aux dossiers du NAS, donc pas dans l'interface) :

| Variable | Défaut | Rôle |
|---|---|---|
| `STUNDTRANSFER_TRANSFER_DIR` | *(vide = mode dépôt désactivé)* | Dossier de réception **dans le conteneur** |
| `STUNDTRANSFER_STAGING_DIR` | `en-cours` à côté du dossier de réception | Envois en cours. Doit être dans le même dossier partagé que la réception pour un rangement instantané |

**Pas de `config.yaml`** : quand un `config.yaml` est monté, Pingvin verrouille tous les réglages de l'interface. Pour passer d'un `config.yaml` à l'interface sans rien perdre, conteneur **arrêté** :

```bash
cd backend
node scripts/stundtransfer-import-config-yaml.cjs /chemin/config.yaml /chemin/data/pingvin-share.db --dry-run   # aperçu
node scripts/stundtransfer-import-config-yaml.cjs /chemin/config.yaml /chemin/data/pingvin-share.db --enable-public-deposit
```

puis retirer la ligne `config.yaml` du `compose.yaml` et reconstruire le projet.

## `compose.yaml` (NAS)

```yaml
services:
  pingvin-share-x:
    image: ghcr.io/stundzow/stundtransfer:latest
    container_name: pingvin
    restart: unless-stopped
    ports:
      - 3000:3000
    environment:
      - TRUST_PROXY=true
      - STUNDTRANSFER_TRANSFER_DIR=/transfer
      - STUNDTRANSFER_STAGING_DIR=/transfer/.en-cours
    volumes:
      - /volume1/docker/pingvin/data:/opt/app/backend/data
      - /volume1/docker/pingvin/data/images:/opt/app/frontend/public/img
      - "/volume1/A - STUND - NAS/5 - StundTransfer:/transfer"
```

**Droits Synology** : le conteneur tourne avec un utilisateur interne (uid 1000). Dans File Station, clic droit sur `5 - StundTransfer` → Propriétés → Autorisation → Créer : **Everyone**, Lecture + Écriture, appliqué à « ce dossier, les sous-dossiers et les fichiers ». Au démarrage, le journal du conteneur indique `Deposit mode enabled` si tout est bon, ou `Deposit folders are not usable (…)` avec la raison.

## Nouvelle installation (autre NAS)

1. Le NAS doit avoir un processeur **Intel/AMD** (Synology « + », ex. DS224+, DS225+, DS423+). Les modèles ARM (DS223, DS220j…) ne sont pas pris en charge.
2. Crée un dossier `docker/stundtransfer` et, dans un dossier partagé, le dossier de réception (ex. `Rushs/StundTransfer`) avec les droits **Everyone : Lecture + Écriture** (voir « Droits Synology »).
3. Container Manager → **Projet** → **Créer**, colle le `compose.yaml` ci-dessus en adaptant les chemins de gauche (`/volume1/...`) à ton NAS.
4. Ouvre `http://<ip-du-nas>:3000/auth/signUp` : **le premier compte créé est administrateur**.
5. Administration → Paramètres :
   - **Partage** → désactive « Autoriser les inscriptions » (sinon n'importe qui peut se créer un compte) ;
   - **Général** → nom de l'appli, logo, adresse publique ;
   - **StundTransfer** → active « Dépôt public ».
6. Pour l'accès depuis internet : adresse DDNS + certificat Let's Encrypt + proxy inversé DSM (HTTPS 443 → `localhost:3000`) + redirection du port 443 sur la box. Jamais le port 3000 directement.

## Mettre à jour le NAS avec la dernière image StundTransfer

1. Vérifie que le build GitHub est vert : https://github.com/StundZow/pingvin-share-x/actions
2. Container Manager → **Projet** → `pingvin` → **Arrêter**.
3. Container Manager → **Image** → `ghcr.io/stundzow/stundtransfer` → **Mettre à jour** (ou supprimer l'image pour forcer le re-téléchargement).
4. Container Manager → **Projet** → `pingvin` → **Construire**.
5. Vérifie que le site s'ouvre.

Revenir en arrière : chaque build est aussi publié avec un tag court (ex. `ghcr.io/stundzow/stundtransfer:a1b2c3d`). Mets ce tag à la place de `latest` dans `compose.yaml`, puis reconstruis le projet. Avant une mise à jour qui ajoute une migration de base de données, sauvegarde `data/pingvin-share.db` (conteneur arrêté).

## Récupérer une mise à jour du projet officiel (upstream)

Le plus simple : demande à Claude Code « mets à jour StundTransfer avec la dernière version officielle de Pingvin Share X ». Sinon, à la main :

```bash
git fetch upstream --tags
git checkout stundtransfer
git merge v1.22.4            # remplace par le tag de la nouvelle version
cd backend && npm ci && npm run test:stundtransfer && cd ..
git push origin stundtransfer # déclenche les tests et la construction de l'image
```

Règles :
- Fusionner uniquement des **tags de version stable** (`vX.Y.Z`), pas `main` (versions bêta).
- Avant de passer à une nouvelle version **majeure** (ex. 2.0), sauvegarder `data/pingvin-share.db` : les migrations ne se défont pas.
- Les migrations Prisma de StundTransfer sont **additives uniquement** (ajout de tables/colonnes, jamais de suppression). Si une migration officielle a une date antérieure à la nôtre, `prisma migrate deploy` l'applique quand même : pas d'action à faire.

### Ce qui est modifié dans le code officiel

Tout le reste est dans des fichiers à nous (`backend/src/stundtransfer/`, `frontend/src/stundtransfer/`, `frontend/src/pages/depot.tsx`, `frontend/src/pages/account/deposits.tsx`, tests, workflow). Chaque ligne modifiée dans un fichier officiel est marquée `StundTransfer` :

| Fichier | Modification |
|---|---|
| `backend/prisma/schema.prisma` | 2 tables ajoutées à la fin (`StundDeposit`, `StundDepositFile`) |
| `backend/src/app.module.ts` | Branche le module `StundTransferModule` |
| `backend/package.json` | Script `test:stundtransfer` |
| `frontend/src/pages/upload/[reverseShareToken].tsx` | Affiche la page de dépôt pour les liens de dépôt |
| `frontend/src/middleware.ts` | L'accueil des visiteurs affiche `/depot` |
| `frontend/src/components/header/Header.tsx` | Visiteurs : icône de connexion seule ; entrée « Dépôts reçus » (mobile) |
| `frontend/src/components/header/NavbarShareMenu.tsx` | Entrée « Dépôts reçus » |
| `frontend/src/components/footer/Footer.tsx` | « Powered by » traduit |
| `frontend/src/pages/account/reverseShares.tsx` | Bouton « Dépôts reçus » |
| `frontend/src/i18n/locales.ts` | Ajoute les textes StundTransfer (fr + en) à toutes les langues, et simplifie quelques textes d'origine |
| `backend/prisma/seed/config.seed.ts` | Section de réglages `stundtransfer` (ajoutée à la fin) |
| `frontend/src/services/config.service.ts` | Autorise la section `stundtransfer` |
| `frontend/src/components/admin/configuration/ConfigurationNavBar.tsx` | Entrée « StundTransfer » dans les paramètres |
| `frontend/src/pages/admin/index.tsx` | Carte « Dépôts reçus », « Paramètres » ouvre la section StundTransfer |

En cas de conflit lors d'une mise à jour : garder la version officielle du fichier, puis réappliquer ces quelques lignes.

## Tests

```bash
cd backend
npm run test:stundtransfer        # nettoyage des noms, chemins, déplacement fiable (tests unitaires)
# Test complet de l'API contre un serveur lancé (voir l'en-tête du fichier) :
node test/stundtransfer/e2e-deposit.mjs
```
