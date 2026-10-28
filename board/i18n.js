/* ============================================================
   Minimal Board — i18n
   Tres idiomas: en (inglés) · ro (rumano) · es (español).
   t('clave', {params}) sustituye {param}.
   ============================================================ */
(function (global) {
'use strict';

const DICT = {

/* ─────────────── EN ─────────────── */
en: {
  'lang.code': 'en',
  'lang.name': 'English',

  'search.ph': 'Search cards…',
  'search.clear': 'Clear search',
  'search.aria': 'Search cards',

  'btn.newCard': 'New card',
  'btn.newCard.title': 'New card (N)',
  'btn.commands': 'Commands',
  'btn.commands.title': 'Commands (⌘K)',
  'btn.theme': 'Toggle theme',
  'btn.theme.title': 'Toggle theme',
  'btn.help': 'Shortcuts',
  'btn.help.title': 'Keyboard shortcuts (?)',
  'btn.lang': 'Language',

  'filter.overdue': 'Overdue',
  'filter.today': 'Due today',
  'filter.checked': 'With checklist',
  'filter.nodue': 'No date',
  'filter.clear': 'Clear',
  'filter.count': '{0} cards',
  'filter.countOf': '{0} of {1} cards',

  'menu.boards': 'Boards',
  'menu.renameBoard': 'Rename board',
  'menu.newBoard': 'New board',
  'menu.export': 'Export JSON',
  'menu.import': 'Import JSON',
  'menu.deleteBoard': 'Delete board',

  'list.rename': 'Rename list',
  'list.wip': 'WIP limit…',
  'list.copy': 'Duplicate list',
  'list.sort': 'Sort A→Z',
  'list.sortdue': 'Sort by date',
  'list.clear': 'Clear list',
  'list.delete': 'Delete list',
  'list.options': 'List options',
  'list.overWip': 'Over the limit ({0})',
  'list.cards': 'Cards',
  'list.addCard': 'Add card',
  'list.addList': 'Add list',
  'list.name': 'List name',
  'list.noMatch': 'No matches',
  'list.empty': 'No cards',

  'composer.ph': 'Card title…',
  'composer.create': 'create',
  'composer.line': 'new line',
  'composer.cancel': 'cancel',

  'card.untitled': 'Untitled',
  'card.noMatchTitle': 'No cards match',
  'card.noMatchBody': 'Try relaxing the filters or the search.',
  'card.clearFilters': 'Clear filters',

  'panel.description': 'Description',
  'panel.descPh': 'Add context, links or acceptance criteria…',
  'panel.list': 'List',
  'panel.start': 'Start date',
  'panel.end': 'End date',
  'panel.datePh': 'tomorrow · in 3 days · 24/12 · 2026-12-24',
  'panel.clearDate': 'Clear date',
  'panel.pickDate': 'Pick a date',
  'cal.pick': 'Pick a date',
  'cal.today': 'Today',
  'cal.tomorrow': 'Tomorrow',
  'cal.week': '+1 week',
  'cal.clear': 'Clear',
  'cal.prev': 'Previous month',
  'cal.next': 'Next month',
  'cal.duration': '{0} days',
  'panel.labels': 'Labels',
  'panel.assignees': 'Assigned to',
  'panel.kind': 'Type',
  'panel.kind.task': 'Task',
  'panel.kind.bug': 'Bug',
  'panel.kind.improvement': 'Improvement',
  'panel.severity': 'Severity',
  'panel.severity.low': 'Low',
  'panel.severity.medium': 'Medium',
  'panel.severity.high': 'High',
  'panel.severity.blocker': 'Blocker',
  'panel.expected': 'What should happen',
  'panel.expected.ph': 'I expected the card to stay where I dropped it…',
  'panel.actual': 'What actually happens',
  'panel.actual.ph': 'Instead, it jumped one position down…',
  'panel.verify': 'Verify',
  'panel.verified': 'Verified',
  'panel.checklists': 'Checklists',
  'panel.addChecklist': '+ Add checklist',
  'panel.delChecklist': 'Delete checklist',
  'panel.addItem': '+ Add item',
  'panel.delete': 'Delete',
  'panel.reopen': 'Reopen',
  'panel.complete': 'Complete',
  'panel.duplicate': 'Duplicate',
  'panel.prev': 'Previous card',
  'panel.next': 'Next card',
  'panel.close': 'Close',
  'panel.itemDelete': 'Delete item',

  'due.overdue': 'Overdue · {0}d',
  'due.today': 'Today',
  'due.tomorrow': 'Tomorrow',
  'due.inDays': 'In {0} days',

  'toast.saveFail': 'Could not save: storage full or blocked',
  'toast.noUndo': 'Nothing to undo',
  'toast.undone': 'Undone',
  'toast.noRedo': 'Nothing to redo',
  'toast.redone': 'Redone',
  'toast.undo': 'Undo',
  'toast.boardCreated': 'Board «{0}» created',
  'toast.newBoard': 'New board',
  'toast.lastBoard': 'You must keep at least one board',
  'toast.boardDeleted': 'Board «{0}» deleted',
  'toast.noDoneList': 'No “Done” list on this board',
  'toast.moved': '«{0}» moved to {1}',
  'toast.deleted': '«{0}» deleted',
  'toast.checklistDone': 'Checklist 100% complete',
  'toast.moveTo': 'Move to {0}',
  'toast.listCleared': '{0} cards deleted from «{1}»',
  'toast.listDeleted': 'List deleted ({0} cards)',
  'toast.exported': 'Exported',
  'toast.imported': 'Imported «{0}»',
  'toast.badFile': 'The file is not valid',
  'toast.completed': '«{0}» completed',
  'toast.welcome': 'Press N to create a card · ? for shortcuts',

  'ask.listName': 'List name',
  'ask.wip': 'WIP limit (empty = no limit)',
  'ask.boardName': 'Board name',
  'ask.deleteBoard': 'Delete «{0}» and all its cards?',

  'cmd.newCard': 'New card',
  'cmd.newList': 'New list',
  'cmd.newBoard': 'New board',
  'cmd.complete': 'Complete card',
  'cmd.delete': 'Delete card',
  'cmd.undo': 'Undo',
  'cmd.redo': 'Redo',
  'cmd.clearFilters': 'Clear filters',
  'cmd.theme': 'Toggle theme',
  'cmd.help': 'Show shortcuts',
  'cmd.ph': 'Type a command…',
  'cmd.empty': 'No command matches «{0}»',

  'help.title': 'Keyboard shortcuts',
  'help.sub': 'Departify Tasks · everything by keyboard, the mouse is optional.',

  'label.bug': 'Bug',
  'label.feature': 'Feature',
  'label.mejora': 'Improvement',
  'label.doc': 'Docs',
  'label.deuda': 'Tech debt',
  'label.urgente': 'Urgent',

  'seed.board': 'Launch v1',
  'seed.list.ideas': 'Ideas',
  'seed.list.doing': 'In progress',
  'seed.list.review': 'Review',
  'seed.list.done': 'Done',
  'seed.c1': 'Evaluate WebSockets for the live feed',
  'seed.c2': 'Decide settings panel typography',
  'seed.c3': 'Research PDF export for the report',
  'seed.c4': 'Rewrite onboarding in 3 steps',
  'seed.c5': 'Fix memory leak in the viewer',
  'seed.c6': 'Migrate fonts to variable font',
  'seed.c7': 'Dark mode contrast tweaks',
  'seed.c8': 'Kick off the project',
  'seed.c9': 'Define the color system',
  'seed.checklist': 'Steps',
  'seed.item.wireframes': 'Wireframes',
  'seed.item.copy': 'Final copy',
  'seed.item.impl': 'Implement',

  'help.sections': [
    { h: 'Navigation', rows: [
      ['Move selection between cards', 'J / K'],
      ['Jump to list 1–9', '1 … 9'],
      ['Close panel / cancel', 'Esc'],
    ]},
    { h: 'Create', rows: [
      ['New card in the active list', 'N'],
      ['New list', '⇧N'],
    ]},
    { h: 'Edit', rows: [
      ['Rename card inline', 'E'],
      ['Edit description', 'D'],
      ['Set a natural date (“tomorrow”, “in 3d”)', 'F'],
      ['Toggle complete ↔ Done', 'Space'],
      ['Archive card', 'X'],
      ['Move to next list', 'Tab'],
    ]},
    { h: 'Navigate the app', rows: [
      ['Search', '/'],
      ['Command palette', '⌘K'],
      ['Undo', '⌘Z'],
      ['Redo', '⇧⌘Z'],
    ]},
    { h: 'Inside a card', rows: [
      ['Add checklist item', 'Enter'],
      ['Toggle item', 'Space'],
      ['Save text field', 'Enter'],
    ]},
  ],
},

/* ─────────────── RO ─────────────── */
ro: {
  'lang.code': 'ro',
  'lang.name': 'Română',

  'search.ph': 'Caută carduri…',
  'search.clear': 'Șterge căutarea',
  'search.aria': 'Caută carduri',

  'btn.newCard': 'Card nou',
  'btn.newCard.title': 'Card nou (N)',
  'btn.commands': 'Comenzi',
  'btn.commands.title': 'Comenzi (⌘K)',
  'btn.theme': 'Schimbă tema',
  'btn.theme.title': 'Schimbă tema',
  'btn.help': 'Scurtături',
  'btn.help.title': 'Scurtături de tastatură (?)',
  'btn.lang': 'Limbă',

  'filter.overdue': 'Întârziate',
  'filter.today': 'Astăzi',
  'filter.checked': 'Cu checklist',
  'filter.nodue': 'Fără dată',
  'filter.clear': 'Șterge',
  'filter.count': '{0} carduri',
  'filter.countOf': '{0} din {1} carduri',

  'menu.boards': 'Table',
  'menu.renameBoard': 'Redenumește tabloul',
  'menu.newBoard': 'Tablou nou',
  'menu.export': 'Exportă JSON',
  'menu.import': 'Importă JSON',
  'menu.deleteBoard': 'Șterge tabloul',

  'list.rename': 'Redenumește lista',
  'list.wip': 'Limită WIP…',
  'list.copy': 'Duplică lista',
  'list.sort': 'Sortează A→Z',
  'list.sortdue': 'Sortează după dată',
  'list.clear': 'Golește lista',
  'list.delete': 'Șterge lista',
  'list.options': 'Opțiuni listă',
  'list.overWip': 'Peste limită ({0})',
  'list.cards': 'Carduri',
  'list.addCard': 'Adaugă card',
  'list.addList': 'Adaugă listă',
  'list.name': 'Numele listei',
  'list.noMatch': 'Nicio potrivire',
  'list.empty': 'Fără carduri',

  'composer.ph': 'Titlu card…',
  'composer.create': 'crează',
  'composer.line': 'linie nouă',
  'composer.cancel': 'anulează',

  'card.untitled': 'Fără titlu',
  'card.noMatchTitle': 'Niciun card nu se potrivește',
  'card.noMatchBody': 'Încearcă să relaxezi filtrele sau căutarea.',
  'card.clearFilters': 'Șterge filtrele',

  'panel.description': 'Descriere',
  'panel.descPh': 'Adaugă context, linkuri sau criteriul de acceptare…',
  'panel.list': 'Listă',
  'panel.start': 'Data de început',
  'panel.end': 'Data de sfârșit',
  'panel.datePh': 'mâine · în 3 zile · 24/12 · 2026-12-24',
  'panel.clearDate': 'Șterge data',
  'panel.pickDate': 'Alege o dată',
  'cal.pick': 'Alege o dată',
  'cal.today': 'Astăzi',
  'cal.tomorrow': 'Mâine',
  'cal.week': '+1 săptămână',
  'cal.clear': 'Șterge',
  'cal.prev': 'Luna anterioară',
  'cal.next': 'Luna următoare',
  'cal.duration': '{0} zile',
  'panel.labels': 'Etichete',
  'panel.assignees': 'Atribuit lui',
  'panel.kind': 'Tip',
  'panel.kind.task': 'Sarcină',
  'panel.kind.bug': 'Defect',
  'panel.kind.improvement': 'Îmbunătățire',
  'panel.severity': 'Severitate',
  'panel.severity.low': 'Scăzută',
  'panel.severity.medium': 'Medie',
  'panel.severity.high': 'Ridicată',
  'panel.severity.blocker': 'Blocant',
  'panel.expected': 'Ce ar trebui să se întâmple',
  'panel.expected.ph': 'Mă așteptam ca cardul să rămână unde l-am lăsat…',
  'panel.actual': 'Ce se întâmplă de fapt',
  'panel.actual.ph': 'În schimb, a sărit o poziție mai jos…',
  'panel.verify': 'Verifică',
  'panel.verified': 'Verificat',
  'panel.checklists': 'Checklist-uri',
  'panel.addChecklist': '+ Adaugă checklist',
  'panel.delChecklist': 'Șterge checklist',
  'panel.addItem': '+ Adaugă element',
  'panel.delete': 'Șterge',
  'panel.reopen': 'Redeschide',
  'panel.complete': 'Finalizează',
  'panel.duplicate': 'Duplică',
  'panel.prev': 'Cardul anterior',
  'panel.next': 'Cardul următor',
  'panel.close': 'Închide',
  'panel.itemDelete': 'Șterge elementul',

  'due.overdue': 'Întârziat · {0}z',
  'due.today': 'Astăzi',
  'due.tomorrow': 'Mâine',
  'due.inDays': 'În {0} zile',

  'toast.saveFail': 'Nu s-a putut salva: stocare plină sau blocată',
  'toast.noUndo': 'Nimic de anulat',
  'toast.undone': 'Anulat',
  'toast.noRedo': 'Nimic de refăcut',
  'toast.redone': 'Refăcut',
  'toast.undo': 'Anulează',
  'toast.boardCreated': 'Tablou «{0}» creat',
  'toast.newBoard': 'Tablou nou',
  'toast.lastBoard': 'Trebuie să rămână cel puțin un tablou',
  'toast.boardDeleted': 'Tablou «{0}» șters',
  'toast.noDoneList': 'Nu există o listă „Gata” pe acest tablou',
  'toast.moved': '«{0}» mutat în {1}',
  'toast.deleted': '«{0}» șters',
  'toast.checklistDone': 'Checklist completat la 100 %',
  'toast.moveTo': 'Mută în {0}',
  'toast.listCleared': '{0} carduri șterse din «{1}»',
  'toast.listDeleted': 'Listă ștearsă ({0} carduri)',
  'toast.exported': 'Exportat',
  'toast.imported': '«{0}» importat',
  'toast.badFile': 'Fișierul nu este valid',
  'toast.completed': '«{0}» finalizat',
  'toast.welcome': 'Apasă N pentru un card · ? pentru scurtături',

  'ask.listName': 'Numele listei',
  'ask.wip': 'Limită WIP (gol = fără limită)',
  'ask.boardName': 'Numele tabloului',
  'ask.deleteBoard': 'Ștergi «{0}» și toate cardurile?',

  'cmd.newCard': 'Card nou',
  'cmd.newList': 'Listă nouă',
  'cmd.newBoard': 'Tablou nou',
  'cmd.complete': 'Finalizează cardul',
  'cmd.delete': 'Șterge cardul',
  'cmd.undo': 'Anulează',
  'cmd.redo': 'Refă',
  'cmd.clearFilters': 'Șterge filtrele',
  'cmd.theme': 'Schimbă tema',
  'cmd.help': 'Arată scurtăturile',
  'cmd.ph': 'Scrie o comandă…',
  'cmd.empty': 'Nicio comandă nu se potrivește cu „{0}”',

  'help.title': 'Scurtături de tastatură',
  'help.sub': 'Departify Taskuri · totul de la tastatură, mouse-ul este opțional.',

  'label.bug': 'Bug',
  'label.feature': 'Funcționalitate',
  'label.mejora': 'Îmbunătățire',
  'label.doc': 'Documentație',
  'label.deuda': 'Datorie tehnică',
  'label.urgente': 'Urgent',

  'seed.board': 'Lansare v1',
  'seed.list.ideas': 'Idei',
  'seed.list.doing': 'În lucru',
  'seed.list.review': 'Revizuire',
  'seed.list.done': 'Gata',
  'seed.c1': 'Evaluează WebSocket pentru fluxul live',
  'seed.c2': 'Alege tipografia panoului de setări',
  'seed.c3': 'Cercetează exportul PDF pentru raport',
  'seed.c4': 'Rescrie onboardingul în 3 pași',
  'seed.c5': 'Repară scurgerea de memorie în vizualizator',
  'seed.c6': 'Migrează fonturile la variable font',
  'seed.c7': 'Ajustări de contrast în modul întunecat',
  'seed.c8': 'Pornește proiectul',
  'seed.c9': 'Definește sistemul de culori',
  'seed.checklist': 'Pași',
  'seed.item.wireframes': 'Wireframes',
  'seed.item.copy': 'Text final',
  'seed.item.impl': 'Implementează',

  'help.sections': [
    { h: 'Navigare', rows: [
      ['Deplasează selecția între carduri', 'J / K'],
      ['Sari la lista 1–9', '1 … 9'],
      ['Închide panoul / anulează', 'Esc'],
    ]},
    { h: 'Creare', rows: [
      ['Card nou în lista activă', 'N'],
      ['Listă nouă', '⇧N'],
    ]},
    { h: 'Editare', rows: [
      ['Redenumează cardul în linie', 'E'],
      ['Editează descrierea', 'D'],
      ['Setează o dată naturală („mâine”, „în 3z”)', 'F'],
      ['Comută finalizat ↔ Gata', 'Space'],
      ['Arhivează cardul', 'X'],
      ['Mută în lista următoare', 'Tab'],
    ]},
    { h: 'Navigarea în aplicație', rows: [
      ['Căutare', '/'],
      ['Paleta de comenzi', '⌘K'],
      ['Anulează', '⌘Z'],
      ['Refă', '⇧⌘Z'],
    ]},
    { h: 'În interiorul unui card', rows: [
      ['Adaugă element de checklist', 'Enter'],
      ['Comută elementul', 'Space'],
      ['Salvează câmpul de text', 'Enter'],
    ]},
  ],
},

/* ─────────────── ES ─────────────── */
es: {
  'lang.code': 'es',
  'lang.name': 'Español',

  'search.ph': 'Buscar tarjetas…',
  'search.clear': 'Limpiar búsqueda',
  'search.aria': 'Buscar tarjetas',

  'btn.newCard': 'Nueva tarjeta',
  'btn.newCard.title': 'Nueva tarjeta (N)',
  'btn.commands': 'Comandos',
  'btn.commands.title': 'Comandos (⌘K)',
  'btn.theme': 'Cambiar tema',
  'btn.theme.title': 'Cambiar tema',
  'btn.help': 'Atajos',
  'btn.help.title': 'Atajos de teclado (?)',
  'btn.lang': 'Idioma',

  'filter.overdue': 'Vencidas',
  'filter.today': 'Para hoy',
  'filter.checked': 'Con checklist',
  'filter.nodue': 'Sin fecha',
  'filter.clear': 'Limpiar',
  'filter.count': '{0} tarjetas',
  'filter.countOf': '{0} de {1} tarjetas',

  'menu.boards': 'Tableros',
  'menu.renameBoard': 'Renombrar tablero',
  'menu.newBoard': 'Nuevo tablero',
  'menu.export': 'Exportar JSON',
  'menu.import': 'Importar JSON',
  'menu.deleteBoard': 'Eliminar tablero',

  'list.rename': 'Renombrar lista',
  'list.wip': 'Límite WIP…',
  'list.copy': 'Duplicar lista',
  'list.sort': 'Ordenar A→Z',
  'list.sortdue': 'Ordenar por fecha',
  'list.clear': 'Vaciar lista',
  'list.delete': 'Eliminar lista',
  'list.options': 'Opciones de la lista',
  'list.overWip': 'Por encima del límite ({0})',
  'list.cards': 'Tarjetas',
  'list.addCard': 'Añadir tarjeta',
  'list.addList': 'Añadir lista',
  'list.name': 'Nombre de la lista',
  'list.noMatch': 'Sin coincidencias',
  'list.empty': 'Sin tarjetas',

  'composer.ph': 'Título de la tarjeta…',
  'composer.create': 'crear',
  'composer.line': 'línea',
  'composer.cancel': 'cancelar',

  'card.untitled': 'Sin título',
  'card.noMatchTitle': 'Ninguna tarjeta coincide',
  'card.noMatchBody': 'Prueba a relajar los filtros o la búsqueda.',
  'card.clearFilters': 'Limpiar filtros',

  'panel.description': 'Descripción',
  'panel.descPh': 'Añade contexto, enlaces o el criterio de aceptación…',
  'panel.list': 'Lista',
  'panel.start': 'Fecha de inicio',
  'panel.end': 'Fecha de fin',
  'panel.datePh': 'mañana · en 3 días · 24/12 · 2026-12-24',
  'panel.clearDate': 'Quitar fecha',
  'panel.pickDate': 'Elegir una fecha',
  'cal.pick': 'Elegir una fecha',
  'cal.today': 'Hoy',
  'cal.tomorrow': 'Mañana',
  'cal.week': '+1 semana',
  'cal.clear': 'Limpiar',
  'cal.prev': 'Mes anterior',
  'cal.next': 'Mes siguiente',
  'cal.duration': '{0} días',
  'panel.labels': 'Etiquetas',
  'panel.assignees': 'Asignado a',
  'panel.kind': 'Tipo',
  'panel.kind.task': 'Tarea',
  'panel.kind.bug': 'Fallo',
  'panel.kind.improvement': 'Mejora',
  'panel.severity': 'Gravedad',
  'panel.severity.low': 'Baja',
  'panel.severity.medium': 'Media',
  'panel.severity.high': 'Alta',
  'panel.severity.blocker': 'Bloqueante',
  'panel.expected': 'Qué debería pasar',
  'panel.expected.ph': 'Esperaba que la tarjeta se quedara donde la solté…',
  'panel.actual': 'Qué pasa en realidad',
  'panel.actual.ph': 'En cambio, salta una posición hacia abajo…',
  'panel.verify': 'Verificar',
  'panel.verified': 'Verificado',
  'panel.checklists': 'Checklists',
  'panel.addChecklist': '+ Añadir checklist',
  'panel.delChecklist': 'Eliminar checklist',
  'panel.addItem': '+ Añadir elemento',
  'panel.delete': 'Eliminar',
  'panel.reopen': 'Reabrir',
  'panel.complete': 'Completar',
  'panel.duplicate': 'Duplicar',
  'panel.prev': 'Tarjeta anterior',
  'panel.next': 'Tarjeta siguiente',
  'panel.close': 'Cerrar',
  'panel.itemDelete': 'Eliminar elemento',

  'due.overdue': 'Vencida · {0}d',
  'due.today': 'Hoy',
  'due.tomorrow': 'Mañana',
  'due.inDays': 'En {0} días',

  'toast.saveFail': 'No se pudo guardar: almacenamiento lleno o bloqueado',
  'toast.noUndo': 'Nada que deshacer',
  'toast.undone': 'Deshecho',
  'toast.noRedo': 'Nada que rehacer',
  'toast.redone': 'Rehecho',
  'toast.undo': 'Deshacer',
  'toast.boardCreated': 'Tablero «{0}» creado',
  'toast.newBoard': 'Tablero nuevo',
  'toast.lastBoard': 'Debe quedar al menos un tablero',
  'toast.boardDeleted': 'Tablero «{0}» eliminado',
  'toast.noDoneList': 'No hay una lista «Hecho» en este tablero',
  'toast.moved': '«{0}» movida a {1}',
  'toast.deleted': '«{0}» eliminada',
  'toast.checklistDone': 'Checklist completa al 100 %',
  'toast.moveTo': 'Mover a {0}',
  'toast.listCleared': '{0} tarjetas eliminadas de «{1}»',
  'toast.listDeleted': 'Lista eliminada ({0} tarjetas)',
  'toast.exported': 'Exportado',
  'toast.imported': 'Importado «{0}»',
  'toast.badFile': 'El archivo no tiene un formato válido',
  'toast.completed': '«{0}» completada',
  'toast.welcome': 'Pulsa N para crear una tarjeta · ? para ver atajos',

  'ask.listName': 'Nombre de la lista',
  'ask.wip': 'Límite WIP (vacío = sin límite)',
  'ask.boardName': 'Nombre del tablero',
  'ask.deleteBoard': '¿Eliminar «{0}» y todas sus tarjetas?',

  'cmd.newCard': 'Nueva tarjeta',
  'cmd.newList': 'Nueva lista',
  'cmd.newBoard': 'Nuevo tablero',
  'cmd.complete': 'Completar tarjeta',
  'cmd.delete': 'Eliminar tarjeta',
  'cmd.undo': 'Deshacer',
  'cmd.redo': 'Rehacer',
  'cmd.clearFilters': 'Limpiar filtros',
  'cmd.theme': 'Cambiar tema',
  'cmd.help': 'Ver atajos',
  'cmd.ph': 'Escribe un comando…',
  'cmd.empty': 'Ningún comando coincide con «{0}»',

  'help.title': 'Atajos de teclado',
  'help.sub': 'Departify Tareas · todo con teclado, el ratón es opcional.',

  'label.bug': 'Bug',
  'label.feature': 'Feature',
  'label.mejora': 'Mejora',
  'label.doc': 'Docs',
  'label.deuda': 'Deuda',
  'label.urgente': 'Urgente',

  'seed.board': 'Lanzamiento v1',
  'seed.list.ideas': 'Ideas',
  'seed.list.doing': 'En curso',
  'seed.list.review': 'Revisión',
  'seed.list.done': 'Hecho',
  'seed.c1': 'Evaluar WebSockets para el feed en vivo',
  'seed.c2': 'Decidir tipografía del panel de ajustes',
  'seed.c3': 'Investigar export a PDF del informe',
  'seed.c4': 'Reescribir el onboarding en 3 pasos',
  'seed.c5': 'Corregir fuga de memoria en el visor',
  'seed.c6': 'Migrar fuentes a variable font',
  'seed.c7': 'Ajustes de contraste en modo oscuro',
  'seed.c8': 'Arrancar el proyecto',
  'seed.c9': 'Definir el sistema de colores',
  'seed.checklist': 'Pasos',
  'seed.item.wireframes': 'Wireframes',
  'seed.item.copy': 'Copy definitivo',
  'seed.item.impl': 'Implementar',

  'help.sections': [
    { h: 'Navegación', rows: [
      ['Mover selección entre tarjetas', 'J / K'],
      ['Saltar a la lista 1–9', '1 … 9'],
      ['Cerrar panel / cancelar', 'Esc'],
    ]},
    { h: 'Crear', rows: [
      ['Nueva tarjeta en la lista activa', 'N'],
      ['Nueva lista', '⇧N'],
    ]},
    { h: 'Editar', rows: [
      ['Renombrar tarjeta en línea', 'E'],
      ['Editar descripción', 'D'],
      ['Fijar fecha natural («mañana», «en 3d»)', 'F'],
      ['Marcar como completada ↔ Hecho', 'Space'],
      ['Archivar tarjeta', 'X'],
      ['Mover a la lista siguiente', 'Tab'],
    ]},
    { h: 'Navegar por la app', rows: [
      ['Buscar', '/'],
      ['Paleta de comandos', '⌘K'],
      ['Deshacer', '⌘Z'],
      ['Rehacer', '⇧⌘Z'],
    ]},
    { h: 'Atajos dentro de una tarjeta', rows: [
      ['Añadir elemento de checklist', 'Enter'],
      ['Marcar / desmarcar elemento', 'Space'],
      ['Guardar campo de texto', 'Enter'],
    ]},
  ],
},
};

const LANGS = ['en', 'ro', 'es'];
const FALLBACK = 'en';
const STORAGE_KEY = 'minimal-board:lang';

let current = FALLBACK;

/** Sustituye {param} con los valores dados. */
function interpolate(str, params) {
  if (!params) return str;
  return String(str).replace(/\{(\w+)\}/g, (m, k) =>
    (params[k] !== undefined && params[k] !== null ? params[k] : m));
}

/** Traduce una clave. Si falta, devuelve la clave (visible al developear). */
function t(key, params) {
  const pack = DICT[current] || {};
  let v = pack[key];
  if (v === undefined) v = DICT[FALLBACK][key];
  if (v === undefined) return key;
  if (Array.isArray(v)) return v;
  return interpolate(v, params);
}

/** Clave de etiqueta de color (los ids no cambian con el idioma). */
function labelName(id) {
  return t('label.' + id);
}

const LOCALES = { en: 'en-GB', ro: 'ro-RO', es: 'es-ES' };
const locale = () => LOCALES[current] || 'en-GB';

/** Nombre propio de un idioma ("Română"), sea cual sea el idioma actual. */
function langEndonym(code) {
  const pack = DICT[code];
  return pack ? pack['lang.name'] : code;
}

function getLang() { return current; }

function setLang(code) {
  if (!DICT[code]) code = FALLBACK;
  current = code;
  try { localStorage.setItem(STORAGE_KEY, code); } catch (e) {}
  if (typeof document !== 'undefined') {
    document.documentElement.lang = code;
    applyStatic();
  }
  return code;
}

/** Idioma guardado o el del navegador. */
function initLang() {
  let saved = null;
  try { saved = localStorage.getItem(STORAGE_KEY); } catch (e) {}
  if (saved && DICT[saved]) return setLang(saved);
  const nav = (navigator.language || '').slice(0, 2).toLowerCase();
  return setLang(LANGS.includes(nav) ? nav : FALLBACK);
}

/** Pinta los nodos marcados con data-i18n* del HTML estático. */
function applyStatic(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  scope.querySelectorAll('[data-i18n-ph]').forEach((el) => {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-ph')));
  });
  scope.querySelectorAll('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria')));
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
  });
}

global.I18N = { t, labelName, locale, getLang, setLang, initLang, applyStatic, LANGS, langEndonym };

})(window);