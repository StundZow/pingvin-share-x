# StundTransfer

Fork de [Pingvin Share X](https://github.com/smp46/pingvin-share-x) transformé en outil de **dépôt de rushs** : la personne dit qui elle est et pour quelle vidéo, dépose ses fichiers, et ils arrivent directement dans `transfer/<Nom> - <Vidéo>/` sur le NAS.

- Branche de travail : `stundtransfer` (partie de la version officielle **v1.22.3**)
- Image Docker : `ghcr.io/stundzow/stundtransfer:latest`, construite automatiquement par GitHub Actions à chaque envoi sur la branche `stundtransfer` (fichier `.github/workflows/stundtransfer-image.yml`)
- Chaque modification d'un fichier existant du projet officiel est marquée par un commentaire `StundTransfer:`. Le code propre à StundTransfer vit dans des fichiers/dossiers dédiés.

## Remotes Git

| Remote     | Adresse                                         | Rôle                        |
|------------|-------------------------------------------------|-----------------------------|
| `origin`   | https://github.com/StundZow/pingvin-share-x     | Ton fork (on pousse ici)    |
| `upstream` | https://github.com/smp46/pingvin-share-x        | Projet officiel (lecture)   |

## Mettre à jour le NAS avec la dernière image StundTransfer

1. Vérifie que le build GitHub est vert : https://github.com/StundZow/pingvin-share-x/actions
2. Container Manager → **Projet** → `pingvin` → **Arrêter**.
3. Container Manager → **Image** → `ghcr.io/stundzow/stundtransfer` → **Mettre à jour** (ou supprimer l'image pour forcer le re-téléchargement).
4. Container Manager → **Projet** → `pingvin` → **Construire** (ou Démarrer).
5. Vérifie que le site s'ouvre et que tu peux te connecter.

Revenir en arrière : chaque build est aussi publié avec un tag court (ex. `ghcr.io/stundzow/stundtransfer:a1b2c3d`). Mets ce tag à la place de `latest` dans `compose.yaml`, puis reconstruis le projet.

## Récupérer une mise à jour du projet officiel (upstream)

Le plus simple : demande à Claude Code « mets à jour StundTransfer avec la dernière version officielle de Pingvin Share X ». Sinon, à la main :

```bash
git fetch upstream --tags
git checkout stundtransfer
git merge v1.22.4            # remplace par le tag de la nouvelle version
# En cas de conflit : garder la version officielle + réappliquer les lignes marquées "StundTransfer:"
git push origin stundtransfer # déclenche la construction de la nouvelle image
```

Règles :
- Fusionner uniquement des **tags de version stable** (`vX.Y.Z`), pas `main` (qui contient des versions bêta).
- Avant de passer à une nouvelle version **majeure** (ex. 2.0), sauvegarder `data/pingvin-share.db` : les migrations de base de données ne se défont pas.
- Les migrations Prisma de StundTransfer sont **additives uniquement** (ajout de tables/colonnes, jamais de suppression).
