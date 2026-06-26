# Phase 0 — Launch prompt

> Paste this whole block into a new **Cowork** session to run Phase 0.
> It is self-contained and re-entrant: re-send it as-is if a session ends mid-way.

---

```
Run in: Cowork

# BarclaudeGateway — Phase 0: Requirements clarification & architecture decisions

## Cross-cutting rules (apply without exception, all phases)
1. Never decide alone. Surface options with plain-language impacts; the user chooses.
2. Plain language only. No jargon, no technical bullet lists. Say what each choice means in
   practice — what it costs, what it gains, what it risks.
3. All artifacts (code, docs, config, variable names, comments, commit messages) in English.
4. All discussion with the user is in French.
5. No code is written in this phase. Phase 0 is decisions only.
6. This phase ends by generating the Phase 1 launch prompt — only after explicit user validation.
7. PROJECT_CONTEXT.md and decisions.md are updated at the end of the phase.

## Resume check (do this first)
Before anything else:
- Read, in full:
  - specifications/PROJECT_CONTEXT.md
  - specifications/decisions.md
  - specifications/ROADMAP.md
  - specifications/api/chronodrive/contract.md
- In decisions.md, list which CLARIFY-* and DECISION-* items are still OPEN vs already Resolved.
- State clearly: "Resuming from item X" or "Starting from the beginning."
- Do not re-ask anything already recorded under "Resolved."

## Goal
Resolve EVERY open functional ambiguity and architecture decision, so that Phase 1
(dev environment setup & repository bootstrap) can start with zero unknowns. At the end,
no decision in decisions.md or PROJECT_CONTEXT.md may remain OPEN.

## Method
Walk the items below ONE AT A TIME, in French, in this order. For each: restate the question in
plain language, present the options with their practical impact, ask, and wait for the user's
choice before moving on. If a later answer contradicts an earlier one, stop and reconcile.

────────────────────────────────────────────────────────────
PART 1 — Functional clarifications (decide these first)
────────────────────────────────────────────────────────────

[CLARIFY-01] Produit scanné introuvable chez Chronodrive
Quand un code-barres scanné ne correspond à aucun produit Chronodrive, que doit-il se passer ?
- A : journaliser l'événement comme une erreur, et ne rien faire de plus.
- B : journaliser ET afficher une alerte visible dans l'interface web, pour que tu le remarques.
- C : journaliser, alerter, ET te permettre de chercher et associer manuellement le code-barres.
Impact : A est le plus simple mais silencieux ; C demande plus d'écran et de travail mais ne perd
aucun produit ; B est l'entre-deux.

[CLARIFY-02] Intention du scan : liste vs panier
Tu scannes à la maison (pour préparer une future commande) ou au dernier moment (pour ajouter
directement au panier en cours). Les deux cas existent-ils ? Et comment bascule-t-on entre
"ajouter à la liste" et "ajouter au panier" ?
- A : le mode est réglé une fois dans la page de configuration (un aller-retour aux réglages).
- B : un bouton physique sur l'ESP32 bascule le mode (aucune action dans l'interface).
- C : les deux se font toujours en même temps (liste ET panier) — pas de notion de mode.
Impact : A est simple mais lent à changer ; B demande de la config ESPHome en plus ; C supprime
le choix mais peut remplir le panier sans que tu le veuilles.

[CLARIFY-03] Quelle liste de courses reçoit les produits scannés
Le compte a deux listes : "Temp prochaine courses" et "Classiques". Les produits vont-ils vers une
seule liste fixe, plusieurs à la fois, ou un choix configurable ?
- A : une seule liste choisie globalement dans la config.
- B : plusieurs listes activables simultanément — le produit scanné va dans toutes les listes actives.
- C : chaque scan vise une liste différente (demande une action par scan — probablement trop complexe).
Impact : A est simple ; B couvre plus de cas sans complexité par scan ; C est le plus souple mais
le plus pénible à l'usage.

[CLARIFY-04] Retour physique au moment du scan
Quand l'ESP32 scanne, veux-tu un retour physique immédiat (LED, buzzer) indiquant succès ou échec ?
- A : aucun retour physique — une entrée dans le journal suffit.
- B : l'ESPHome pilote une LED/un buzzer selon la réponse HTTP du middleware (demande de la config
  ESPHome en plus du middleware).
Impact : A ne touche pas au matériel ; B est plus confortable à l'usage mais élargit le périmètre
côté ESP32 (et conditionne le contrat de réponse défini en Phase 3).

[CLARIFY-05] Notification d'erreur au-delà de l'interface web
Si l'API Chronodrive casse pendant la nuit, une erreur visible dans l'interface suffit-elle, ou
veux-tu une notification proactive (alerte Home Assistant, notification sur le téléphone) ?
- A : interface web seulement — tu vérifies quand quelque chose semble anormal.
- B : déclencher une notification Home Assistant via webhook lors d'une erreur API critique.
Impact : B demande un champ de config (l'URL du webhook HA) et ajoute une dépendance, mais te
prévient sans que tu aies à regarder l'interface.

[CLARIFY-06] Workflow de debug HAR : première version ou plus tard ?
La page de maintenance montrera un tutoriel de capture HAR (Firefox) et un prompt Claude prêt à
coller pour diagnostiquer une API cassée. Faut-il ça dès la première version qui marche, ou plus tard
une fois le cœur stable ?
- A : dès le départ — ça fait partie de la vision de maintenance long terme.
- B : reporter en Phase 5 — la première version se concentre sur le flux scan→Chronodrive.
Impact : A allonge le premier livrable ; B le raccourcit mais retarde l'outillage de diagnostic.

────────────────────────────────────────────────────────────
PART 2 — Architecture decisions
────────────────────────────────────────────────────────────

[DECISION-001] Protocole de communication ESP32 → middleware
Comment l'ESP32 dit-il à l'app "je viens de scanner le code 1234567890" ?
- A — HTTP POST : l'ESP32 envoie une requête HTTP directement à l'IP/nom local de l'app.
  Simple à configurer dans ESPHome, facile à déboguer. Mais si l'app est éteinte au moment du scan,
  ce scan est perdu sans trace. Aucune infrastructure en plus.
- B — MQTT : l'ESP32 publie sur un sujet ; l'app s'abonne via un broker (ex. Mosquitto dans Home
  Assistant). Découplé : l'app peut redémarrer sans perdre les scans en attente (si le broker les
  retient). Demande un broker qui tourne — que tu as probablement déjà. Mise en place un peu plus complexe.
Question à te poser d'abord : "Est-ce que tu utilises déjà MQTT / Mosquitto dans ton homelab
(via Home Assistant par exemple) ?"

[DECISION-002] Langage et framework du backend
- A — Node.js / TypeScript : même stack que ton projet Macronome. Cohérent avec tes habitudes, bon
  support async HTTP et WebSocket pour le flux de logs. Rien de nouveau à apprendre.
- B — Python : courant dans l'outillage homelab, large écosystème, mais différent de ta stack habituelle.
- C — Autre : seulement si tu as une préférence forte.
Impact : ce choix conditionne toute la Phase 2 et l'outillage de la Phase 1.

[DECISION-003] Stockage de la configuration et des logs
Où l'app range-t-elle : identifiants Chronodrive, listes utilisées, bascule panier, historique des scans ?
- A — SQLite : un seul fichier base de données dans le conteneur, monté en volume Docker. Simple,
  pas de service en plus, survit aux redémarrages, interrogeable.
- B — Fichier JSON + fichier de log en ajout continu : deux fichiers texte, montés en volume.
  Très simple et lisible, mais le log grossit sans limite et les écritures concurrentes sont risquées.
- C — PostgreSQL : conteneur de base séparé. Robuste, déjà présent chez toi (Macronome), mais
  surdimensionné ici et ajoute un conteneur + une dépendance.
Impact : conditionne le stockage des secrets (chiffrés au repos) et le montage de volume en Phase 6.

[DECISION-004] Technologie de l'interface web
- A — React + Vite : comme ton app Hellfest. Cohérent, bon support réactif pour le flux de logs.
  Demande une étape de build.
- B — HTML/JS vanilla : servi directement par le backend, aucun outillage de build. Très simple à
  déployer, mais plus verbeux pour le temps réel.
- C — HTMX : peu de JS, HTML rendu serveur avec extensions temps réel. Léger, pas de build, mais
  pattern différent de tes projets existants.
Impact : conditionne toute la Phase 4.

[DECISION-005] Construction et publication de l'image Docker
- A — GitHub Actions → GHCR : un push GitHub déclenche le build et publie l'image sur ghcr.io.
  Standard, gratuit, versionné automatiquement. Demande un dépôt GitHub + une config Actions (une fois).
- B — Build local + push manuel : pas de CI, marche tout de suite, mais étape manuelle à chaque
  déploiement, facile à oublier, pas de versionnage automatique.
Impact : conditionne la Phase 6 et une partie du setup Phase 1.

[DECISION-006] Monorepo vs paquets séparés
Backend et frontend dans le même dépôt, ou séparés ?
- A — Monorepo : tout au même endroit, un seul build Docker. Plus simple pour un projet solo,
  cohérent avec Macronome.
- B — Dépôts/paquets séparés : séparation nette, déployables indépendamment, mais surcoût de
  coordination probablement excessif pour ce projet.
Impact : conditionne la structure de dépôt créée en Phase 1.

────────────────────────────────────────────────────────────

## Expected outputs (deliverables)
1. decisions.md updated: every CLARIFY-* and DECISION-* moved to "Resolved", each with the chosen
   option, who decided, and the rationale.
2. PROJECT_CONTEXT.md updated: the OPEN decisions table emptied — no item left OPEN.
3. The Phase 1 launch prompt (Dev environment setup & repository bootstrap), fully self-contained
   (Run in, resume check, steps, validation gate), generated as the FINAL deliverable.

## Validation gate (end of phase)
1. Present a summary in French of every decision taken.
2. Ask the user: anything to change, add, or challenge?
3. Wait for explicit go-ahead.
4. ONLY THEN: generate and print the Phase 1 launch prompt.
```
