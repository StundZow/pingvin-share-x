// StundTransfer: texts of the deposit mode. Merged into every language in
// i18n/locales.ts (languages other than French fall back to English).
const english: Record<string, string> = {
  "stundtransfer.page.title": "Drop files",
  "stundtransfer.footer.powered-by": "Powered by",
  "stundtransfer.guest.closed.title": "No drop open",
  "stundtransfer.guest.closed.description":
    "There is no open drop right now. If someone sent you a link, open it directly.",

  "stundtransfer.form.title": "Send your files",
  "stundtransfer.form.subtitle":
    "Tell us who you are and which video it is for, then add your files or folders.",
  "stundtransfer.form.uploader.label": "Who are you?",
  "stundtransfer.form.uploader.placeholder": "e.g. Litsu",
  "stundtransfer.form.video.label": "Which video is it for?",
  "stundtransfer.form.video.placeholder": "e.g. Beamng",
  "stundtransfer.form.missing-fields": "Fill in both fields to send",

  "stundtransfer.dropzone.title": "Drop your files or folders here",
  "stundtransfer.dropzone.description":
    "or click to choose files. Maximum size: {maxSize}.",
  "stundtransfer.dropzone.folder": "Choose a folder",

  "stundtransfer.files.summary":
    "{count, plural, one {# file} other {# files}} · {size}",
  "stundtransfer.files.more": "… and {count} more",
  "stundtransfer.files.clear": "Remove all",
  "stundtransfer.files.ignored":
    "{count, plural, one {# system file ignored} other {# system files ignored}} (.DS_Store, Thumbs.db…)",
  "stundtransfer.files.duplicate": "Already added: {name}",
  "stundtransfer.files.too-big":
    "Too big: this link accepts {maxSize} at most.",

  "stundtransfer.button.send": "Send",

  "stundtransfer.upload.preparing": "Preparing the upload…",
  "stundtransfer.upload.title": "Uploading…",
  "stundtransfer.upload.keep-open":
    "Keep this page open until the end. If the connection drops, the upload resumes by itself.",
  "stundtransfer.upload.progress": "{sent} of {total}",
  "stundtransfer.upload.speed": "{speed}/s",
  "stundtransfer.upload.eta": "Time left: {eta}",
  "stundtransfer.upload.files": "{done} / {total} files done",
  "stundtransfer.upload.reconnecting":
    "Connection lost, retrying automatically…",
  "stundtransfer.upload.finishing": "Finishing…",
  "stundtransfer.upload.confirm-leave":
    "The upload is not finished. If you leave, you can resume it later by dropping the same files again.",

  "stundtransfer.done.title": "✅ Received, thank you!",
  "stundtransfer.done.description":
    "{count, plural, one {Your file arrived safely} other {Your # files arrived safely}} ({size}).",
  "stundtransfer.done.again": "Send more files",

  "stundtransfer.resume.title": "An upload was interrupted",
  "stundtransfer.resume.description":
    "{uploader} / {video}: {received} of {total} already received. Drop the same files or folders again to resume where it stopped.",
  "stundtransfer.resume.matched": "{matched} / {needed} files found",
  "stundtransfer.resume.missing": "Still missing: {names}",
  "stundtransfer.resume.button": "Resume upload",
  "stundtransfer.resume.abandon": "Give up and start over",

  "stundtransfer.error.title": "The upload could not continue",
  "stundtransfer.error.retry": "Try again",
  "stundtransfer.error.stund_link_invalid":
    "This drop link is no longer valid (expired or already used). Ask for a new link.",
  "stundtransfer.error.stund_too_large": "Too big for this link.",
  "stundtransfer.error.stund_not_enough_space":
    "The server is running out of space. Let the person who sent you the link know.",
  "stundtransfer.error.stund_invalid_names":
    'Fill in "Who are you?" and "Which video is it for?".',
  "stundtransfer.error.stund_storage_unavailable":
    "The drop server is not available right now. Try again later.",
  "stundtransfer.error.stund_not_uploading":
    "This upload is already finished or was cancelled.",
  "stundtransfer.error.file-read":
    'Cannot read "{name}". The drive or card may have been unplugged. Plug it back in and drop the files again to resume.',
  "stundtransfer.error.unknown":
    "Something unexpected happened. Reload the page: the upload will resume where it stopped.",

  "stundtransfer.admin.title": "Received deposits",
  "stundtransfer.admin.button": "Received deposits",
  "stundtransfer.admin.empty": "No deposit yet.",
  "stundtransfer.admin.when": "When",
  "stundtransfer.admin.who": "Who",
  "stundtransfer.admin.video": "Video",
  "stundtransfer.admin.files": "Files",
  "stundtransfer.admin.size": "Size",
  "stundtransfer.admin.folder": "Folder",
  "stundtransfer.admin.status": "Status",
  "stundtransfer.admin.status.UPLOADING": "Uploading",
  "stundtransfer.admin.status.MOVING": "Storing",
  "stundtransfer.admin.status.DONE": "OK",
  "stundtransfer.admin.status.ERROR": "Error",
  "stundtransfer.admin.status.ABANDONED": "Abandoned",
  "stundtransfer.admin.retry": "Retry storing",
  "stundtransfer.admin.retry.done": "Storing started again",
  "stundtransfer.admin.remove": "Remove",
  "stundtransfer.admin.remove.confirm.title": "Remove this deposit?",
  "stundtransfer.admin.remove.confirm.pending":
    "The files of this deposit that are still waiting on the server will be deleted. Files already stored in the transfer folder are not touched.",
  "stundtransfer.admin.remove.confirm.history":
    "The deposit is removed from this history. Its files in the transfer folder are not touched.",
  "stundtransfer.admin.details": "Details",
  "stundtransfer.admin.file.original": "Sent as",
  "stundtransfer.admin.file.final": "Stored as",
};

const french: Record<string, string> = {
  "stundtransfer.page.title": "Déposer des fichiers",
  "stundtransfer.footer.powered-by": "Propulsé par",
  "stundtransfer.guest.closed.title": "Aucun dépôt ouvert",
  "stundtransfer.guest.closed.description":
    "Il n'y a pas de dépôt ouvert pour le moment. Si on t'a envoyé un lien, ouvre-le directement.",

  "stundtransfer.form.title": "Envoie tes fichiers",
  "stundtransfer.form.subtitle":
    "Indique qui tu es et pour quelle vidéo, puis ajoute tes fichiers ou dossiers.",
  "stundtransfer.form.uploader.label": "Qui es-tu ?",
  "stundtransfer.form.uploader.placeholder": "ex. Litsu",
  "stundtransfer.form.video.label": "Pour quelle vidéo ?",
  "stundtransfer.form.video.placeholder": "ex. Beamng",
  "stundtransfer.form.missing-fields": "Remplis les deux champs pour envoyer",

  "stundtransfer.dropzone.title": "Glisse tes fichiers ou dossiers ici",
  "stundtransfer.dropzone.description":
    "ou clique pour choisir des fichiers. Taille maximale : {maxSize}.",
  "stundtransfer.dropzone.folder": "Choisir un dossier",

  "stundtransfer.files.summary":
    "{count, plural, one {# fichier} other {# fichiers}} · {size}",
  "stundtransfer.files.more": "… et {count} autres",
  "stundtransfer.files.clear": "Tout retirer",
  "stundtransfer.files.ignored":
    "{count, plural, one {# fichier système ignoré} other {# fichiers système ignorés}} (.DS_Store, Thumbs.db…)",
  "stundtransfer.files.duplicate": "Déjà ajouté : {name}",
  "stundtransfer.files.too-big":
    "C'est trop lourd : ce lien accepte {maxSize} au maximum.",

  "stundtransfer.button.send": "Envoyer",

  "stundtransfer.upload.preparing": "Préparation de l'envoi…",
  "stundtransfer.upload.title": "Envoi en cours…",
  "stundtransfer.upload.keep-open":
    "Laisse cette page ouverte jusqu'à la fin. En cas de coupure, l'envoi reprend tout seul.",
  "stundtransfer.upload.progress": "{sent} sur {total}",
  "stundtransfer.upload.speed": "{speed}/s",
  "stundtransfer.upload.eta": "Temps restant : {eta}",
  "stundtransfer.upload.files": "{done} / {total} fichiers terminés",
  "stundtransfer.upload.reconnecting":
    "Connexion perdue, nouvelle tentative automatique…",
  "stundtransfer.upload.finishing": "Finalisation…",
  "stundtransfer.upload.confirm-leave":
    "L'envoi n'est pas terminé. Si tu quittes, tu pourras le reprendre plus tard en redéposant les mêmes fichiers.",

  "stundtransfer.done.title": "✅ Reçu, merci !",
  "stundtransfer.done.description":
    "{count, plural, one {Ton fichier est bien arrivé} other {Tes # fichiers sont bien arrivés}} ({size}).",
  "stundtransfer.done.again": "Envoyer d'autres fichiers",

  "stundtransfer.resume.title": "Un envoi a été interrompu",
  "stundtransfer.resume.description":
    "{uploader} / {video} : {received} sur {total} déjà reçus. Redépose les mêmes fichiers ou dossiers pour reprendre là où ça s'est arrêté.",
  "stundtransfer.resume.matched": "{matched} / {needed} fichiers retrouvés",
  "stundtransfer.resume.missing": "Il manque encore : {names}",
  "stundtransfer.resume.button": "Reprendre l'envoi",
  "stundtransfer.resume.abandon": "Abandonner et recommencer",

  "stundtransfer.error.title": "L'envoi n'a pas pu continuer",
  "stundtransfer.error.retry": "Réessayer",
  "stundtransfer.error.stund_link_invalid":
    "Ce lien de dépôt n'est plus valable (expiré ou déjà utilisé). Demande un nouveau lien.",
  "stundtransfer.error.stund_too_large": "C'est trop lourd pour ce lien.",
  "stundtransfer.error.stund_not_enough_space":
    "Le serveur n'a plus assez de place. Préviens la personne qui t'a envoyé le lien.",
  "stundtransfer.error.stund_invalid_names":
    "Remplis « Qui es-tu ? » et « Pour quelle vidéo ? ».",
  "stundtransfer.error.stund_storage_unavailable":
    "Le serveur de dépôt n'est pas disponible pour le moment. Réessaie plus tard.",
  "stundtransfer.error.stund_not_uploading":
    "Cet envoi est déjà terminé ou a été annulé.",
  "stundtransfer.error.file-read":
    "Impossible de lire « {name} ». Le disque ou la carte a peut-être été débranché. Rebranche-le et redépose les fichiers pour reprendre.",
  "stundtransfer.error.unknown":
    "Une erreur inattendue est survenue. Recharge la page : l'envoi reprendra là où il s'était arrêté.",

  "stundtransfer.admin.title": "Dépôts reçus",
  "stundtransfer.admin.button": "Dépôts reçus",
  "stundtransfer.admin.empty": "Aucun dépôt pour l'instant.",
  "stundtransfer.admin.when": "Quand",
  "stundtransfer.admin.who": "Qui",
  "stundtransfer.admin.video": "Vidéo",
  "stundtransfer.admin.files": "Fichiers",
  "stundtransfer.admin.size": "Taille",
  "stundtransfer.admin.folder": "Dossier",
  "stundtransfer.admin.status": "Statut",
  "stundtransfer.admin.status.UPLOADING": "En cours",
  "stundtransfer.admin.status.MOVING": "Rangement",
  "stundtransfer.admin.status.DONE": "OK",
  "stundtransfer.admin.status.ERROR": "Erreur",
  "stundtransfer.admin.status.ABANDONED": "Abandonné",
  "stundtransfer.admin.retry": "Réessayer le rangement",
  "stundtransfer.admin.retry.done": "Rangement relancé",
  "stundtransfer.admin.remove": "Supprimer",
  "stundtransfer.admin.remove.confirm.title": "Supprimer ce dépôt ?",
  "stundtransfer.admin.remove.confirm.pending":
    "Les fichiers de ce dépôt encore en attente sur le serveur seront supprimés. Les fichiers déjà rangés dans le dossier transfer ne sont pas touchés.",
  "stundtransfer.admin.remove.confirm.history":
    "Le dépôt est retiré de cet historique. Ses fichiers dans le dossier transfer ne sont pas touchés.",
  "stundtransfer.admin.details": "Détails",
  "stundtransfer.admin.file.original": "Envoyé sous le nom",
  "stundtransfer.admin.file.final": "Rangé sous",
};

const stundTransferMessages: Record<string, Record<string, string>> = {
  "en-US": english,
  "fr-FR": french,
};

export default stundTransferMessages;
