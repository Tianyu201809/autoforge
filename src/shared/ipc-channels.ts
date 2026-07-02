export const IPC = {

  SCRIPTS_LIST: 'scripts:list',

  SCRIPTS_GET: 'scripts:get',

  SCRIPTS_IMPORT: 'scripts:import',

  SCRIPTS_UPDATE: 'scripts:update',

  SCRIPTS_DELETE: 'scripts:delete',

  SCRIPTS_TOGGLE_STAR: 'scripts:toggle-star',

  SCRIPTS_TOGGLE_ARCHIVE: 'scripts:toggle-archive',

  SCRIPTS_OPEN_FILE_DIALOG: 'scripts:open-file-dialog',

  SCRIPTS_OPEN_DIR_DIALOG: 'scripts:open-dir-dialog',

  SCRIPTS_OPEN_ATTACHMENT_DIALOG: 'scripts:open-attachment-dialog',
  SCRIPTS_STAGE_ATTACHMENTS: 'scripts:stage-attachments',
  SCRIPTS_REMOVE_ATTACHMENT: 'scripts:remove-attachment',

  SCRIPTS_GET_CONTENT: 'scripts:get-content',

  SCRIPTS_SET_CONTENT: 'scripts:set-content',
  SCRIPTS_LIST_FILES: 'scripts:list-files',
  SCRIPTS_READ_FILE: 'scripts:read-file',
  SCRIPTS_WRITE_FILE: 'scripts:write-file',

  SCRIPTS_INSTALL_DEPS: 'scripts:install-deps',
  SCRIPTS_SET_ENV_CONFIG: 'scripts:set-env-config',
  SCRIPTS_SET_PARAMS: 'scripts:set-params',

  SCRIPTS_UPDATE_META: 'scripts:update-meta',



  CATEGORIES_LIST: 'categories:list',

  CATEGORIES_CREATE: 'categories:create',

  CATEGORIES_UPDATE: 'categories:update',

  CATEGORIES_DELETE: 'categories:delete',



  ENV_LIST: 'env:list',

  ENV_CREATE: 'env:create',

  ENV_UPDATE: 'env:update',

  ENV_DELETE: 'env:delete',



  RUNNER_START: 'runner:start',

  RUNNER_STOP: 'runner:stop',

  RUNNER_LIST_SESSIONS: 'runner:list-sessions',

  RUNNER_GET_SESSION: 'runner:get-session',

  HISTORY_QUERY: 'history:query',
  HISTORY_FOR_SCRIPT: 'history:for-script',
  HISTORY_TODAY_COUNT: 'history:today-count',



  CONFIG_GET: 'config:get',

  CONFIG_SET: 'config:set',



  DEPS_INSTALL_GLOBAL: 'deps:install-global',
  DEPS_LIST_GLOBAL: 'deps:list-global',
  DEPS_REMOVE_GLOBAL: 'deps:remove-global',

  EXAMPLES_LIST: 'examples:list',
  EXAMPLES_IMPORT: 'examples:import',
  DEV_GUIDE_GET: 'dev-guide:get',
  DEV_GUIDE_SKILL_CREATE_GET: 'dev-guide:skill-create:get',



  SYSTEM_MEMORY: 'system:memory',

  SYSTEM_BROWSER_STATUS: 'system:browser-status',

  SYSTEM_OPEN_PATH: 'system:open-path',

  SYSTEM_USER_DATA_PATH: 'system:user-data-path',

  SYSTEM_PICK_EXTERNAL_EDITOR: 'system:pick-external-editor',

  SYSTEM_OPEN_IN_EXTERNAL_EDITOR: 'system:open-in-external-editor',

  SYSTEM_PYTHON_DETECT: 'system:python-detect',

  SYSTEM_PICK_PYTHON: 'system:pick-python',



  EVENT_LOG: 'event:log',

  EVENT_SESSION: 'event:session',

  EVENT_LIFECYCLE: 'event:lifecycle',

  TERMINAL_OPEN: 'terminal:open',
  TERMINAL_CLOSE: 'terminal:close',
  TERMINAL_TOGGLE_PIN: 'terminal:toggle-pin',
  TERMINAL_IS_OPEN: 'terminal:is-open',
  TERMINAL_IS_PINNED: 'terminal:is-pinned',
  EVENT_TERMINAL_CLOSED: 'terminal:closed',

  EDITOR_OPEN: 'editor:open',
  EDITOR_CLOSE: 'editor:close',
  EDITOR_TOGGLE_PIN: 'editor:toggle-pin',
  EDITOR_IS_OPEN: 'editor:is-open',
  EDITOR_IS_PINNED: 'editor:is-pinned',
  EDITOR_GET_SESSION: 'editor:get-session',
  EDITOR_SYNC: 'editor:sync',
  EDITOR_NOTIFY_SAVED: 'editor:notify-saved',
  EVENT_EDITOR_INIT: 'event:editor-init',
  EVENT_EDITOR_SYNC: 'event:editor-sync',
  EVENT_EDITOR_SAVED: 'event:editor-saved',
  EVENT_EDITOR_CLOSED: 'event:editor-closed',

  WINDOW_SHOW: 'window:show',
  WINDOW_HIDE: 'window:hide',
  WINDOW_TOGGLE: 'window:toggle',
  WINDOW_TOGGLE_PIN: 'window:toggle-pin',
  WINDOW_IS_PINNED: 'window:is-pinned',
  WINDOW_GET_MODE: 'window:get-mode',
  WINDOW_SET_MODE: 'window:set-mode',
  EVENT_WINDOW_MODE: 'event:window-mode'

} as const



export type IpcChannel = (typeof IPC)[keyof typeof IPC]

