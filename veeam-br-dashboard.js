/**
 * Veeam Backup & Replication dashboard strategy.
 *
 * Builds a dashboard from whatever the ha-veeam-br integration has created, so there is
 * nothing to maintain by hand as jobs and repositories come and go.
 *
 * Dashboard:
 *   strategy:
 *     type: custom:veeam-br
 *
 * A single view inside an existing dashboard:
 *   views:
 *     - strategy:
 *         type: custom:veeam-br
 *         group: jobs
 *         title: Backups
 *
 * Options (all optional):
 *   group                 Only for the view strategy: overview | jobs | repositories |
 *                         security | infrastructure (which covers the HA cluster, proxies,
 *                         WAN accelerators, servers and licensing). Defaults to overview.
 *   title, icon, path     Name the generated view. A view strategy has to supply these
 *   theme, background     itself: Home Assistant applies the generated config over the view's
 *   subview, visible      own keys, so a title set beside `strategy:` is ignored, and renaming
 *                         a strategy view in the visual editor replaces the strategy with
 *                         static cards. Set them here instead.
 *   view                   Any other view setting, passed through verbatim:
 *                            view:
 *                              theme: my-theme
 *   summary               Live headline counting failed jobs and full repositories, and
 *                         raising malware, best practice violations and move/copy sessions
 *                         awaiting action. Default true.
 *   badges                Server, cluster, security and license state as badges along the top
 *                         of the overview instead of tiles. Default true.
 *   columns               Maximum section columns. Default 3.
 *   include_diagnostics   Include diagnostic entities. Default false, since they are mostly
 *                         build numbers and IDs. The server's Connected and Health OK, and
 *                         a job's Target, are shown regardless.
 *   include_config        Include config-category entities. Default true — the job start and
 *                         stop buttons live here.
 *   include_hidden        Include entities the user hid. Default false: hiding something and
 *                         having it reappear is not what anyone means.
 *   repository_warn_at    Used-space percentage treated as a warning. Default 85.
 */

const INTEGRATION = "veeam_br";

/** Device models set by the integration. */
const MODEL = {
  JOB: "Backup Job",
  REPOSITORY: "Backup Repository",
  SOBR: "Scale-Out Backup Repository",
  PROXY: "Backup Proxy",
  WAN: "WAN Accelerator",
  SERVER: "Backup & Replication Server",
  LICENSE: "License",
  CLUSTER: "High Availability Cluster",
  SECURITY: "Security",
};

/** Section heading and icon per model, in the order they should appear. */
const MODEL_DISPLAY = [
  [MODEL.JOB, "Backup jobs", "mdi:backup-restore"],
  [MODEL.REPOSITORY, "Repositories", "mdi:database"],
  [MODEL.SOBR, "Scale-out repositories", "mdi:database-plus"],
  [MODEL.PROXY, "Backup proxies", "mdi:server-network"],
  [MODEL.WAN, "WAN accelerators", "mdi:speedometer"],
  [MODEL.SECURITY, "Security", "mdi:shield-lock"],
  [MODEL.CLUSTER, "High availability", "mdi:server-security"],
  [MODEL.SERVER, "Servers", "mdi:server"],
  [MODEL.LICENSE, "Licensing", "mdi:certificate"],
];

/**
 * The kind word the integration puts after "VBR " in a device name — "VBR Job Nightly VMs".
 *
 * A section already headed "Backup jobs" does not need to say "VBR Job" on every title.
 */
const MODEL_KIND = {
  [MODEL.JOB]: "Job",
  [MODEL.REPOSITORY]: "Repository",
  [MODEL.SOBR]: "SOBR",
  [MODEL.PROXY]: "Proxy",
  [MODEL.WAN]: "WAN Accelerator",
  [MODEL.SERVER]: "Server",
  [MODEL.LICENSE]: "License",
  [MODEL.CLUSTER]: "HA Cluster",
  [MODEL.SECURITY]: "Security",
};

const DEVICE_NAME_PREFIX = "VBR ";

/** Models whose name is the server's, so without the kind it would be mistaken for the server. */
const KEEP_KIND = new Set([MODEL.LICENSE, MODEL.CLUSTER, MODEL.SECURITY]);

const MODEL_ICON = new Map(MODEL_DISPLAY.map(([model, , icon]) => [model, icon]));
const MODEL_TITLE = new Map(MODEL_DISPLAY.map(([model, title]) => [model, title]));
const MODEL_ORDER = MODEL_DISPLAY.map(([model]) => model);

/** Models whose state belongs in the overview badges rather than in a section of its own. */
const PLATFORM_MODELS = [MODEL.CLUSTER, MODEL.SERVER, MODEL.SECURITY, MODEL.LICENSE];

const GROUPS = ["overview", "jobs", "repositories", "security", "infrastructure"];

const GROUP_VIEW = {
  overview: { title: "Overview", path: "overview", icon: "mdi:backup-restore" },
  jobs: { title: "Jobs", path: "jobs", icon: "mdi:file-tree" },
  repositories: { title: "Repositories", path: "repositories", icon: "mdi:database" },
  security: { title: "Security", path: "security", icon: "mdi:shield-lock" },
  infrastructure: { title: "Infrastructure", path: "infrastructure", icon: "mdi:server" },
};

const DEFAULTS = {
  summary: true,
  badges: true,
  columns: 3,
  include_diagnostics: false,
  include_config: true,
  include_hidden: false,
  repository_warn_at: 85,
};

/**
 * The one entity that answers "is this thing all right?", per model.
 *
 * The overview shows exactly one tile per device, named for the device — several tiles from one
 * device all carrying the device name is what made it unreadable. First match wins.
 *
 * A suffix may name its domain, as "binary_sensor._connected": the server's Recovery Appliances
 * Connected sensor ends in "_connected" too, and says nothing about whether the server answers.
 */
const PRIMARY_SUFFIXES = {
  // Status reports what a job is doing and never reports failure, so Last Result leads
  [MODEL.JOB]: ["_last_result", "_status"],
  [MODEL.REPOSITORY]: ["_used_percentage", "_online", "_capacity"],
  [MODEL.SOBR]: ["_extent_count", "_description"],
  [MODEL.PROXY]: ["_online", "_enabled"],
  [MODEL.WAN]: ["_cache_size"],
  [MODEL.SERVER]: ["binary_sensor._connected", "_name"],
  [MODEL.LICENSE]: ["_status", "_expiration_date"],
  [MODEL.CLUSTER]: ["_online", "_failover_in_progress"],
  // Detected objects need API 1.3-rev2 while the analyzer is in every revision, so a server can
  // have Best Practices and no Malware Detected
  [MODEL.SECURITY]: [
    "binary_sensor._malware_detected",
    "binary_sensor._best_practices",
    "_best_practice_violations",
    "_malware_events_24h",
  ],
};

/** Entities promoted to badges, most important first. */
const BADGE_SUFFIXES = {
  [MODEL.CLUSTER]: ["_online", "_failover_in_progress"],
  [MODEL.SERVER]: ["binary_sensor._connected", "_health_ok"],
  [MODEL.SECURITY]: ["binary_sensor._malware_detected", "binary_sensor._best_practices"],
  [MODEL.LICENSE]: ["_status", "_expiration_date"],
};

/**
 * Diagnostic entities shown even with include_diagnostics off, and placed among the states.
 *
 * The integration files nearly every server entity under diagnostics, Connected and Health OK
 * included — but whether the server answers is the first thing anyone wants to know, and
 * without them the server device has nothing on the dashboard at all. A job's Target is filed
 * there too, but where a job writes to is what tells two similar jobs apart, not a build number.
 */
const ALWAYS_SHOWN_SUFFIXES = {
  [MODEL.SERVER]: ["binary_sensor._connected", "_health_ok"],
  [MODEL.JOB]: ["_target"],
};

/** Within a device section, states read best in this order. */
const ENTITY_ORDER = [
  "_status",
  "_last_result",
  "_target",
  "binary_sensor._connected",
  "_health_ok",
  "_move_copy_sessions_awaiting_action",
  "_recovery_appliances_connected",
  "_malware_detected",
  "_best_practices",
  "_infected_objects",
  "_suspicious_objects",
  "_best_practice_violations",
  "_malware_events_24h",
  "_last_malware_event",
  "_last_analyzer_run",
  "_online",
  "_enabled",
  "_out_of_date",
  "_used_percentage",
  "_capacity",
  "_used_space",
  "_free_space",
  "_last_run",
  "_next_run",
];

function options(config) {
  return { ...DEFAULTS, ...(config || {}) };
}

function slugify(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * A device's name without the integration's "VBR <kind> " lead-in.
 *
 * Devices are named "VBR Job Nightly VMs" or "VBR Default Backup Repository" (the kind is left
 * out when the name already says it); earlier releases used the bare name. Under a heading of
 * "Backup jobs" the title should read "Nightly VMs" either way. A name the user gave the device
 * is theirs and is used as it is.
 *
 * The kind stays where dropping it would say less: a license and a cluster are named after the
 * server, so "vbr01" would read as the server itself, and "VBR WAN Accelerator 01" could have
 * come from an accelerator called "WAN Accelerator 01" — "01" alone names nothing.
 */
function deviceName(device) {
  if (device.name_by_user) return device.name_by_user;

  const name = device.name || "";
  if (!name) return "Unnamed";
  if (!name.startsWith(DEVICE_NAME_PREFIX)) return name;

  const rest = name.slice(DEVICE_NAME_PREFIX.length).trim();
  if (!rest) return name;

  const kind = MODEL_KIND[device.model];
  if (!kind || KEEP_KIND.has(device.model)) return rest;
  if (!rest.toLowerCase().startsWith(`${kind.toLowerCase()} `)) return rest;

  const bare = rest.slice(kind.length).trim();
  return /[a-z]/i.test(bare) ? bare : rest;
}

function objectId(entity) {
  return (entity.entity_id || "").split(".").slice(1).join(".");
}

/**
 * The object id, and the same without the "_2" Home Assistant appends when an ID is taken.
 *
 * binary_sensor.default_backup_repository_immutable_2 is still the Immutable sensor.
 */
function objectIdStems(entity) {
  const id = objectId(entity);
  const stem = id.replace(/_\d+$/, "");
  return stem === id ? [id] : [id, stem];
}

/**
 * Whether an entity is the one a suffix such as "_last_result" names.
 *
 * Entity IDs come in two schemes: an install from before device names were prefixed keeps
 * sensor.nightly_vms_last_result in the registry, a new one gets
 * sensor.vbr_job_nightly_vms_last_result. Both end the same way. The entity's own name is
 * checked too, so a user who renamed the entity ID does not lose the tile. A suffix written as
 * "binary_sensor._connected" matches only in that domain.
 */
function hasSuffix(entity, qualified) {
  const dot = qualified.indexOf(".");
  if (dot !== -1 && !(entity.entity_id || "").startsWith(qualified.slice(0, dot + 1))) return false;
  const suffix = dot === -1 ? qualified : qualified.slice(dot + 1);

  if (objectIdStems(entity).some((stem) => stem.endsWith(suffix))) return true;
  const own = slugify(entity.original_name);
  return own ? `_${own}`.endsWith(suffix) : false;
}

function byName(a, b) {
  return deviceName(a).localeCompare(deviceName(b), undefined, { numeric: true });
}

/**
 * The entity's own short name — "Status", "Last Result", "Start".
 *
 * Inside a section already titled with the device name, the full friendly name repeats it on
 * every tile. The registry keeps the user's override and the original separately, so a rename
 * is still respected.
 */
function entityName(entity, device) {
  const own = entity.name || entity.original_name;
  if (own) return own;

  // No registry name: derive one from the object id, minus the device slug it starts with —
  // the full "vbr_job_nightly_vms" of a new install or the bare "nightly_vms" of an older one
  const [id] = objectIdStems(entity).slice(-1);
  const slugs = [device.name_by_user, device.name, deviceName(device)]
    .map(slugify)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const slug = slugs.find((candidate) => id.startsWith(`${candidate}_`));
  const trimmed = slug ? id.slice(slug.length + 1) : id;

  return trimmed
    .split("_")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Entities that describe a device rather than say how it is doing.
 *
 * A job's Target on the overview, standing in for a Last Result that is not shown, would read
 * as the job's state — "Local VM and Media Backups" in place of Success or Failed.
 */
const CONTEXT_SUFFIXES = ["_target"];

function isContext(entity) {
  return CONTEXT_SUFFIXES.some((suffix) => hasSuffix(entity, suffix));
}

function isButton(entity) {
  return (entity.entity_id || "").startsWith("button.");
}

function orderRank(entity) {
  const index = ENTITY_ORDER.findIndex((suffix) => hasSuffix(entity, suffix));
  return index === -1 ? ENTITY_ORDER.length : index;
}

/**
 * Entities belonging to this integration, keyed by device.
 *
 * Filtering on the registry rather than on entity_id patterns means renamed entities are
 * still found, and entities the user disabled or hid stay out of the way.
 */
function entitiesByDevice(entities, devices, opts) {
  const byDevice = new Map();
  const modelOf = new Map(devices.map((device) => [device.id, device.model]));
  const alwaysShown = (entity) =>
    (ALWAYS_SHOWN_SUFFIXES[modelOf.get(entity.device_id)] || []).some((suffix) =>
      hasSuffix(entity, suffix),
    );

  for (const entity of entities) {
    if (entity.platform !== INTEGRATION) continue;
    if (entity.disabled_by) continue;
    if (entity.hidden_by && !opts.include_hidden) continue;
    if (entity.entity_category === "diagnostic" && !opts.include_diagnostics) {
      if (!alwaysShown(entity)) continue;
    }
    if (entity.entity_category === "config" && !opts.include_config) continue;
    if (!entity.device_id) continue;

    const list = byDevice.get(entity.device_id) || [];
    list.push(entity);
    byDevice.set(entity.device_id, list);
  }

  // States first, in reading order, then buttons, then diagnostics — so a card leads with what
  // someone opened the dashboard to see and the controls sit together at the end. A diagnostic
  // shown regardless is shown because it matters, so it sits with the states.
  for (const list of byDevice.values()) {
    list.sort((a, b) => {
      const category = (entity) => {
        if (entity.entity_category === "diagnostic" && !alwaysShown(entity)) return 2;
        if (isButton(entity)) return 1;
        return 0;
      };
      const byCategory = category(a) - category(b);
      if (byCategory !== 0) return byCategory;

      const byOrder = orderRank(a) - orderRank(b);
      if (byOrder !== 0) return byOrder;
      return (a.entity_id || "").localeCompare(b.entity_id || "");
    });
  }

  return byDevice;
}

/** Devices of this integration that still have at least one usable entity. */
function devicesWithEntities(devices, byDevice) {
  return devices
    .filter((device) => !device.disabled_by && byDevice.has(device.id))
    .sort(byName);
}

function groupByModel(devices) {
  const groups = new Map();
  for (const device of devices) {
    const model = device.model || "Other";
    const list = groups.get(model) || [];
    list.push(device);
    groups.set(model, list);
  }
  return groups;
}

/**
 * Map config entry id -> a label for it.
 *
 * With one server the label is unused; with several, titles are suffixed with the server name
 * so two identically named jobs on different servers can be told apart.
 */
function entryLabels(devices) {
  const labels = new Map();
  for (const device of devices) {
    if (device.model !== MODEL.SERVER) continue;
    for (const entryId of device.config_entries || []) {
      labels.set(entryId, deviceName(device));
    }
  }
  return labels;
}

function entryOf(device) {
  return (device.config_entries || [])[0];
}

/**
 * The server label a title needs with several servers, or null.
 *
 * A license or a Security device is named after its server already — "License vbr01" — and
 * "License vbr01 — vbr01" says it twice.
 */
function serverLabel(device, labels, multiServer) {
  if (!multiServer) return null;
  const label = labels.get(entryOf(device));
  if (!label || deviceName(device).endsWith(label)) return null;
  return label;
}

// ---------------------------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------------------------

function tile(entityId, extra = {}) {
  return { type: "tile", entity: entityId, ...extra };
}

function heading(text, icon, extra = {}) {
  return {
    type: "heading",
    heading: text,
    heading_style: "title",
    ...(icon ? { icon } : {}),
    ...extra,
  };
}

function section(cards, extra = {}) {
  return { type: "grid", cards, ...extra };
}

function titledSection(title, icon, cards, extra = {}) {
  return section([heading(title, icon), ...cards], extra);
}

function markdown(content, extra = {}) {
  return { type: "markdown", content, ...extra };
}

/** A used-space percentage reads far better as a gauge than as "0.2%" on a tile. */
function gauge(entityId, name, warnAt) {
  return {
    type: "gauge",
    entity: entityId,
    name,
    min: 0,
    max: 100,
    needle: true,
    severity: { green: 0, yellow: warnAt, red: Math.min(95, warnAt + 10) },
  };
}

function findBySuffixes(entities, suffixes) {
  for (const suffix of suffixes || []) {
    const found = entities.find((entity) => hasSuffix(entity, suffix));
    if (found) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Live summary
//
// Generated once per page load, so nothing here may depend on current states — a stale
// snapshot baked into card order or colour is worse than none. The counting is left to a
// template, which Home Assistant re-renders as states change.
// ---------------------------------------------------------------------------------------------

function jinjaList(entityIds) {
  return `[${entityIds.map((id) => `'${id}'`).join(", ")}]`;
}

function jobSummary(entityIds) {
  return [
    `{% set jobs = ${jinjaList(entityIds)} %}`,
    // Lower-cased because the API has shipped both casings for these enums between revisions
    "{% set r = jobs | map('states') | map('lower') | list %}",
    "{% set failed = r | select('eq', 'failed') | list | count %}",
    "{% set warned = r | select('eq', 'warning') | list | count %}",
    "{% set ok = r | select('eq', 'success') | list | count %}",
    "{% set running = r | select('eq', 'running') | list | count %}",
    // A job whose endpoint failed this poll goes unavailable rather than showing stale data
    "{% set lost = r | select('in', ['unavailable', 'unknown']) | list | count %}",
    "{% set other = jobs | count - failed - warned - ok - running - lost %}",
    "## {% if failed %}{{ failed }} job{{ 's' if failed > 1 else '' }} failed" +
      "{% elif warned %}{{ warned }} job{{ 's' if warned > 1 else '' }} finished with warnings" +
      "{% elif lost %}{{ lost }} job{{ 's' if lost > 1 else '' }} unavailable" +
      "{% elif ok %}All {{ ok }} job{{ 's' if ok > 1 else '' }} succeeded" +
      "{% elif running %}{{ running }} job{{ 's' if running > 1 else '' }} running" +
      "{% else %}No job results yet{% endif %}",
    "{{ ok }} succeeded &nbsp;·&nbsp; {{ warned }} with warnings &nbsp;·&nbsp; " +
      "{{ failed }} failed" +
      "{% if running %} &nbsp;·&nbsp; {{ running }} running{% endif %}" +
      "{% if lost %} &nbsp;·&nbsp; {{ lost }} unavailable{% endif %}" +
      "{% if other %} &nbsp;·&nbsp; {{ other }} with no result{% endif %}",
  ].join("\n");
}

function repositorySummary(entityIds, warnAt) {
  return [
    `{% set repos = ${jinjaList(entityIds)} %}`,
    `{% set used = repos | map('states') | map('float', -1) | select('ge', ${warnAt}) | list %}`,
    // An unavailable repository is not known to be below the threshold, so it is not counted
    // as though it were
    "{% set lost = repos | map('states') | map('float', -1) | select('lt', 0) | list | count %}",
    "{% if used | count %}**{{ used | count }}** of {{ repos | count }} " +
      `repositories are at or above ${warnAt}% used.` +
      "{% elif lost < repos | count %}" +
      `All {{ repos | count - lost }} reporting repositories are below ${warnAt}% used.` +
      "{% endif %}" +
      "{% if lost %} **{{ lost }}** {{ 'is' if lost == 1 else 'are' }} unavailable.{% endif %}",
  ].join("\n");
}

/**
 * Malware and best practice violations, raised as banners when there are any.
 *
 * Counted from the problem sensors the Security tiles and badges show, so the headline cannot
 * disagree with them; the object counts come from Malware Detected's own attributes. A server
 * without detected-object support (before API 1.3-rev2) simply has no Malware Detected, and the
 * sentence then says only what is known.
 */
function securitySummary(malwareIds, practiceIds) {
  const lines = [
    `{% set malware = ${jinjaList(malwareIds)} %}`,
    `{% set practices = ${jinjaList(practiceIds)} %}`,
    "{% set infected_on = malware | select('is_state', 'on') | list %}",
    "{% set violating_on = practices | select('is_state', 'on') | list %}",
    "{% set infected = infected_on | map('state_attr', 'infected') | map('int', 0) | sum %}",
    "{% set suspicious = infected_on | map('state_attr', 'suspicious') | map('int', 0) | sum %}",
    "{% set lost = (malware + practices) | map('states') " +
      "| select('in', ['unavailable', 'unknown']) | list | count %}",
    "{% if infected_on %}" +
      '<ha-alert alert-type="error" title="Malware detected">' +
      "{{ infected }} infected and {{ suspicious }} suspicious " +
      "object{{ '' if infected + suspicious == 1 else 's' }}" +
      "{% if malware | count > 1 %} on {{ infected_on | count }} of {{ malware | count }} " +
      "servers{% endif %}. See the Security view.</ha-alert>" +
      "{% endif %}",
    "{% if violating_on %}" +
      '<ha-alert alert-type="warning" title="Best practices not followed">' +
      "The Security & Compliance Analyzer reports violations" +
      "{% if practices | count > 1 %} on {{ violating_on | count }} of " +
      "{{ practices | count }} servers{% endif %}.</ha-alert>" +
      "{% endif %}",
    "{% if not infected_on and not violating_on and not lost %}" +
      (malwareIds.length ? "No malware detected" : "") +
      (malwareIds.length && practiceIds.length ? ", and no" : practiceIds.length ? "No" : "") +
      (practiceIds.length ? " best practice violations" : "") +
      ".{% elif lost %}Security state is unavailable for {{ lost }} " +
      "sensor{{ '' if lost == 1 else 's' }}.{% endif %}",
  ];
  return lines.join("\n");
}

/** Backup moves and copies stopped part-way, which wait for someone to decide. */
function moveCopySummary(entityIds) {
  return [
    `{% set awaiting = ${jinjaList(entityIds)} | map('states') | map('int', 0) | sum %}`,
    "{% if awaiting %}" +
      '<ha-alert alert-type="warning" title="Move/copy sessions awaiting action">' +
      "{{ awaiting }} backup move/copy session{{ '' if awaiting == 1 else 's' }} " +
      "{{ 'is' if awaiting == 1 else 'are' }} waiting for a decision. " +
      "See the server on the Infrastructure view.</ha-alert>" +
      "{% endif %}",
  ].join("\n");
}

function summarySection(groups, byDevice, opts, columns) {
  // The same entity the tiles use, so the headline can never disagree with what is below it.
  // Which one that is depends on the options: Last Result is a diagnostic entity, so with
  // diagnostics off the count comes from Status — which reports the last result unless the job
  // is running.
  const collect = (model, suffixes) =>
    (groups.get(model) || [])
      .map((device) => findBySuffixes(byDevice.get(device.id) || [], suffixes))
      .filter(Boolean)
      .map((entity) => entity.entity_id);

  const jobs = collect(MODEL.JOB, PRIMARY_SUFFIXES[MODEL.JOB]);
  const repositories = collect(MODEL.REPOSITORY, ["_used_percentage"]);
  const malware = collect(MODEL.SECURITY, ["binary_sensor._malware_detected"]);
  const practices = collect(MODEL.SECURITY, ["binary_sensor._best_practices"]);
  const moveCopy = collect(MODEL.SERVER, ["sensor._move_copy_sessions_awaiting_action"]);

  const parts = [];
  if (jobs.length) parts.push(jobSummary(jobs));
  if (repositories.length) parts.push(repositorySummary(repositories, opts.repository_warn_at));
  if (malware.length || practices.length) parts.push(securitySummary(malware, practices));
  if (moveCopy.length) parts.push(moveCopySummary(moveCopy));
  if (!parts.length) return null;

  return section([markdown(parts.join("\n\n"))], { column_span: columns });
}

// ---------------------------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------------------------

/** One section per device, listing its entities by their own short names. */
function deviceSections(devices, byDevice, labels, multiServer, opts) {
  return devices.map((device) => {
    const entities = byDevice.get(device.id) || [];
    const label = serverLabel(device, labels, multiServer);
    const title = label ? `${deviceName(device)} — ${label}` : deviceName(device);

    const cards = entities.map((entity) => {
      const name = entityName(entity, device);
      // Only a repository's: a license's Instances Used Percentage ends the same way, and
      // "Used space" on it would be wrong
      if (device.model === MODEL.REPOSITORY && hasSuffix(entity, "_used_percentage")) {
        // "Used Percentage" beside a gauge marked 0-100 says nothing the gauge does not; a name
        // the user chose themselves is kept as it is
        return gauge(entity.entity_id, entity.name || "Used space", opts.repository_warn_at);
      }
      // A button's state is the time it was last pressed, or nothing at all — noise next to a
      // control whose label already says what it does
      if (isButton(entity)) {
        return tile(entity.entity_id, { name, hide_state: true });
      }
      return tile(entity.entity_id, { name });
    });

    // A gauge wedged between two tiles reads as a mistake; it belongs at the top of the section
    const gauges = cards.filter((card) => card.type === "gauge");
    const rest = cards.filter((card) => card.type !== "gauge");

    return titledSection(title, MODEL_ICON.get(device.model), [
      ...alertNotes(entities),
      ...gauges,
      ...rest,
      ...failedEndpointsNote(entities),
    ]);
  });
}

/** The first entity in one domain whose ID or name ends in a suffix. */
function findIn(entities, domain, suffix) {
  return entities.find(
    (entity) => entity.entity_id.startsWith(`${domain}.`) && hasSuffix(entity, suffix),
  );
}

/**
 * Banners at the top of a section, each shown only while there is something to act on.
 *
 * Malware Detected and Best Practices are problem sensors, and their tiles already read
 * Problem or OK; the banner says what the problem is, from the attributes the integration puts
 * on them. The visibility conditions are evaluated live, so nothing here is fixed at render
 * time — which is also why they are banners rather than a tile coloured when generated.
 */
function alertNotes(entities) {
  const notes = [];

  const malware = findIn(entities, "binary_sensor", "_malware_detected");
  if (malware) {
    const id = malware.entity_id;
    notes.push(
      markdown(
        `{% set infected = state_attr('${id}', 'infected') | int(0) %}` +
          `{% set suspicious = state_attr('${id}', 'suspicious') | int(0) %}` +
          `{% set objects = state_attr('${id}', 'objects') or [] %}` +
          '<ha-alert alert-type="error" title="Malware detected">' +
          "{{ infected }} infected and {{ suspicious }} suspicious " +
          "object{{ '' if infected + suspicious == 1 else 's' }}" +
          "{% if objects %}, most recently " +
          "{{ objects[:5] | map(attribute='name') | select | join(', ') }}{% endif %}." +
          "</ha-alert>",
        { visibility: [{ condition: "state", entity: id, state: "on" }] },
      ),
    );
  }

  const practices = findIn(entities, "binary_sensor", "_best_practices");
  if (practices) {
    const id = practices.entity_id;
    notes.push(
      markdown(
        `{% set violating = state_attr('${id}', 'violating') or [] %}` +
          '<ha-alert alert-type="warning" title="Best practices not followed">' +
          "{% if violating %}{{ violating | join(', ') }}" +
          "{% else %}The Security & Compliance Analyzer reports a violation.{% endif %}" +
          "</ha-alert>",
        { visibility: [{ condition: "state", entity: id, state: "on" }] },
      ),
    );
  }

  const moveCopy = findIn(entities, "sensor", "_move_copy_sessions_awaiting_action");
  if (moveCopy) {
    const id = moveCopy.entity_id;
    notes.push(
      markdown(
        `{% set count = states('${id}') | int(0) %}` +
          `{% set sessions = state_attr('${id}', 'sessions') or [] %}` +
          '<ha-alert alert-type="warning" ' +
          "title=\"{{ count }} move/copy session{{ '' if count == 1 else 's' }} awaiting action\">" +
          "{% for s in sessions[:5] %}{{ s.name or s.job_name or s.id }}" +
          "{{ ', ' if not loop.last else '' }}{% endfor %}" +
          "{% if sessions %} — {% endif %}" +
          "Settle with the <code>veeam_br.manage_move_copy_session</code> action." +
          "</ha-alert>",
        { visibility: [{ condition: "numeric_state", entity: id, above: 0 }] },
      ),
    );
  }

  return notes;
}

/**
 * Which endpoints failed, shown only while Health OK is off.
 *
 * Health OK turns off when any endpoint fails in a poll and lists them in its
 * failed_endpoints attribute; a bare "off" does not say where to look. The visibility
 * condition is evaluated live, so nothing here is fixed at render time.
 */
function failedEndpointsNote(entities) {
  const health = entities.find(
    (entity) => entity.entity_id.startsWith("binary_sensor.") && hasSuffix(entity, "_health_ok"),
  );
  if (!health) return [];

  const id = health.entity_id;
  return [
    markdown(
      `{% set failed = state_attr('${id}', 'failed_endpoints') or [] %}` +
        "{% if failed %}**Failing endpoints:** {{ failed | join(', ') }}" +
        "{% else %}The last poll did not complete.{% endif %}",
      { visibility: [{ condition: "state", entity: id, state: "off" }] },
    ),
  ];
}

/** One tile per device, named for the device. */
function overviewSections(groups, byDevice, labels, multiServer, opts, columns) {
  const sections = [];

  const summary = opts.summary ? summarySection(groups, byDevice, opts, columns) : null;
  if (summary) sections.push(summary);

  // With badges on, platform state lives along the top and these models are covered in full on
  // the Infrastructure view; with badges off they need a section here or they are lost
  const skip = opts.badges ? new Set(PLATFORM_MODELS) : new Set();

  for (const model of MODEL_ORDER) {
    if (skip.has(model)) continue;

    const devices = groups.get(model);
    if (!devices || !devices.length) continue;

    const cards = [];
    for (const device of devices) {
      const entities = byDevice.get(device.id) || [];
      const primary =
        findBySuffixes(entities, PRIMARY_SUFFIXES[model]) ||
        entities.find((entity) => !isButton(entity) && !isContext(entity));
      if (!primary) continue;

      const label = serverLabel(device, labels, multiServer);
      cards.push(
        tile(primary.entity_id, {
          name: label ? `${deviceName(device)} (${label})` : deviceName(device),
        }),
      );
    }

    if (cards.length) {
      sections.push(titledSection(MODEL_TITLE.get(model) || model, MODEL_ICON.get(model), cards));
    }
  }

  return sections;
}

/** Server, cluster and license state, along the top of the overview. */
function overviewBadges(groups, byDevice, labels, multiServer) {
  const badges = [];

  for (const model of PLATFORM_MODELS) {
    for (const device of groups.get(model) || []) {
      const entities = byDevice.get(device.id) || [];
      for (const suffix of BADGE_SUFFIXES[model] || []) {
        const entity = entities.find((candidate) => hasSuffix(candidate, suffix));
        if (!entity) continue;

        const label = multiServer ? labels.get(entryOf(device)) : null;
        const name = entityName(entity, device);
        badges.push({
          type: "entity",
          entity: entity.entity_id,
          name: label ? `${name} (${label})` : name,
          show_state: true,
          show_name: true,
        });
      }
    }
  }

  return badges;
}

function emptyView(opts) {
  return {
    title: opts.title || "Veeam",
    icon: opts.icon || "mdi:backup-restore",
    cards: [
      markdown(
        "### No Veeam entities found\n\n" +
          "This dashboard builds itself from the " +
          "[Veeam Backup & Replication integration](https://github.com/Cenvora/ha-veeam-br). " +
          "Add the integration under **Settings → Devices & Services**, then reload this page.\n\n" +
          "If the integration is already set up, its entities may all be disabled or hidden.",
      ),
    ],
  };
}

/** Everything the layout needs, derived once from the registries. */
function analyse(registries, opts) {
  const byDevice = entitiesByDevice(registries.entities || [], registries.devices || [], opts);
  const devices = devicesWithEntities(registries.devices || [], byDevice);

  return {
    byDevice,
    devices,
    groups: groupByModel(devices),
    labels: entryLabels(devices),
    multiServer: new Set(devices.map(entryOf).filter(Boolean)).size > 1,
  };
}

/** Build the sections for one group. Exported for the view strategy and for tests. */
export function buildSections(group, registries, config) {
  const opts = options(config);
  const columns = opts.columns;
  const { byDevice, devices, groups, labels, multiServer } = analyse(registries, opts);

  if (!devices.length) return null;

  const sectionsFor = (models) =>
    deviceSections(
      models.flatMap((model) => groups.get(model) || []),
      byDevice,
      labels,
      multiServer,
      opts,
    );

  switch (group) {
    case "jobs":
      return sectionsFor([MODEL.JOB]);
    case "repositories":
      return sectionsFor([MODEL.REPOSITORY, MODEL.SOBR]);
    case "security":
      // A server whose API version or account has none of it has no Security device, and so
      // no section — and with no section anywhere, no Security view either
      return sectionsFor([MODEL.SECURITY]);
    case "infrastructure":
      return sectionsFor([MODEL.CLUSTER, MODEL.PROXY, MODEL.WAN, MODEL.SERVER, MODEL.LICENSE]);
    case "overview":
    default:
      return overviewSections(groups, byDevice, labels, multiServer, opts, columns);
  }
}

/**
 * View settings the strategy config can carry.
 *
 * Everything the view editor would normally set has to be settable here instead: Home Assistant
 * applies the generated config over the view's own keys, and renaming or restyling a strategy
 * view in the visual editor replaces the strategy with static cards.
 */
const VIEW_SETTINGS = [
  "title",
  "path",
  "icon",
  "theme",
  "background",
  "subview",
  "visible",
  "max_columns",
  "dense_section_placement",
  "header",
  "top_margin",
];

/**
 * Whatever the config asks to put on the view.
 *
 * `view:` is a verbatim escape hatch, so a key Home Assistant adds later needs no change here.
 * `type`, `sections`, `badges` and `cards` are ours to decide and are not accepted.
 */
function viewSettings(opts) {
  const settings = {};
  for (const key of VIEW_SETTINGS) {
    if (opts[key] !== undefined) settings[key] = opts[key];
  }

  const verbatim = { ...(opts.view || {}) };
  for (const key of ["type", "sections", "badges", "cards", "strategy"]) delete verbatim[key];

  return { ...settings, ...verbatim };
}

/**
 * Build one view. Exported for tests.
 *
 * Titles come from the strategy config rather than the view, because Home Assistant applies a
 * strategy's generated config over the view's own keys.
 */
export function buildView(group, registries, config) {
  const opts = options(config);
  const sections = buildSections(group, registries, config);
  if (!sections || !sections.length) return null;

  const defaults = GROUP_VIEW[group] || GROUP_VIEW.overview;
  const view = {
    title: defaults.title,
    path: defaults.path,
    icon: defaults.icon,
    max_columns: opts.columns,
    dense_section_placement: true,
    ...viewSettings(opts),
    type: "sections",
    sections,
  };

  if (group === "overview" && opts.badges) {
    const { byDevice, groups, labels, multiServer } = analyse(registries, opts);
    const badges = overviewBadges(groups, byDevice, labels, multiServer);
    if (badges.length) view.badges = badges;
  }

  return view;
}

/** Build the whole dashboard. Exported for tests. */
export function buildDashboard(registries, config) {
  const opts = options(config);
  const views = [];

  // One name cannot serve four views, and one path certainly cannot, so a dashboard keeps its
  // per-group names. Every other view setting — theme, background — applies to all of them.
  const { title, path, icon, view: perView, ...rest } = config || {};
  const shared = { ...(perView || {}) };
  for (const key of ["title", "path", "icon"]) delete shared[key];
  const viewConfig = { ...rest, view: shared };

  for (const group of GROUPS) {
    const generated = buildView(group, registries, viewConfig);
    // Skip a view with nothing in it rather than showing an empty tab
    if (generated) views.push(generated);
  }

  if (!views.length) return { views: [emptyView(opts)] };

  return { views };
}

async function loadRegistries(hass) {
  const [devices, entities] = await Promise.all([
    hass.callWS({ type: "config/device_registry/list" }),
    hass.callWS({ type: "config/entity_registry/list" }),
  ]);
  return { devices, entities };
}

// customElements.define requires an HTMLElement subclass, but Home Assistant only ever calls
// the static generate(). Resolving the base at runtime keeps the module importable outside a
// browser, which is what makes the build logic testable.
const StrategyBase = typeof HTMLElement === "undefined" ? class {} : HTMLElement;

class VeeamBrDashboardStrategy extends StrategyBase {
  static async generate(config, hass) {
    return buildDashboard(await loadRegistries(hass), config);
  }
}

class VeeamBrViewStrategy extends StrategyBase {
  static async generate(config, hass) {
    const group = GROUPS.includes(config?.group) ? config.group : "overview";
    const view = buildView(group, await loadRegistries(hass), config);

    if (!view) {
      const opts = options(config);
      const empty = markdown("No Veeam entities found.");
      return {
        type: "sections",
        title: opts.title || "Veeam",
        icon: opts.icon || "mdi:backup-restore",
        sections: [titledSection("Veeam", "mdi:backup-restore", [empty])],
      };
    }

    return view;
  }
}

// Registered defensively: a dashboard can be reloaded without a full page refresh, and
// defining an existing element throws.
if (typeof customElements !== "undefined") {
  if (!customElements.get("ll-strategy-dashboard-veeam-br")) {
    customElements.define("ll-strategy-dashboard-veeam-br", VeeamBrDashboardStrategy);
  }
  if (!customElements.get("ll-strategy-view-veeam-br")) {
    customElements.define("ll-strategy-view-veeam-br", VeeamBrViewStrategy);
  }
}

console.info("%c VEEAM-BR-DASHBOARD %c strategy loaded ", "color:white;background:#00b336", "");
