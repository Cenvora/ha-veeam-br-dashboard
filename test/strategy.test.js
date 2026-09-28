/**
 * Tests for the dashboard strategy.
 *
 * Zero dependencies: node:test plus the module itself, which is plain ESM with no build step.
 * The registry fixtures mirror what Home Assistant returns for the ha-veeam-br integration,
 * including the entity_category, original_name and platform fields the layout depends on.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboard, buildSections, buildView } from "../veeam-br-dashboard.js";

const ENTRY = "entry-1";
const ENTRY_2 = "entry-2";

function device(id, name, model, entry = ENTRY, extra = {}) {
  return {
    id,
    name,
    name_by_user: null,
    model,
    manufacturer: "Veeam",
    config_entries: [entry],
    identifiers: [["veeam_br", id]],
    disabled_by: null,
    ...extra,
  };
}

function entity(entityId, deviceId, originalName = null, extra = {}) {
  return {
    entity_id: entityId,
    device_id: deviceId,
    platform: "veeam_br",
    name: null,
    original_name: originalName,
    entity_category: null,
    disabled_by: null,
    hidden_by: null,
    ...extra,
  };
}

/** A registry set covering every device model the integration creates. */
function registries() {
  return {
    devices: [
      device("job-1", "Nightly VMs", "Backup Job"),
      device("job-2", "Weekly Files", "Backup Job"),
      device("repo-1", "Default Backup Repository", "Backup Repository"),
      device("sobr-1", "Main SOBR", "Scale-Out Backup Repository"),
      device("server-1", "vbr01", "Backup & Replication Server"),
      device("license-1", "Veeam License (vbr01)", "License"),
      device("cluster-1", "VBR-HA (vbr01)", "High Availability Cluster"),
      device("proxy-1", "VMware Backup Proxy", "Backup Proxy"),
      device("proxy-2", "Backup Proxy", "Backup Proxy"),
      device("wan-1", "WAN Accelerator 01", "WAN Accelerator"),
      // New in integration 0.8.0, so named "VBR <kind> <server>" on every install
      device("security-1", "VBR Security vbr01", "Security"),
    ],
    entities: [
      entity("sensor.nightly_vms_status", "job-1", "Status"),
      entity("sensor.nightly_vms_last_result", "job-1", "Last Result"),
      entity("sensor.nightly_vms_last_run", "job-1", "Last Run"),
      entity("sensor.nightly_vms_type", "job-1", "Type", { entity_category: "diagnostic" }),
      entity("button.nightly_vms_start", "job-1", "Start", { entity_category: "config" }),
      entity("sensor.nightly_vms_target", "job-1", "Target", { entity_category: "diagnostic" }),
      entity("sensor.weekly_files_last_result", "job-2", "Last Result"),
      entity("sensor.weekly_files_target", "job-2", "Target", { entity_category: "diagnostic" }),
      entity("sensor.default_backup_repository_used_percentage", "repo-1", "Used Percentage"),
      entity("binary_sensor.default_backup_repository_online", "repo-1", "Online"),
      entity("sensor.main_sobr_extent_count", "sobr-1", "Extent Count"),
      // The integration files every server entity under diagnostics
      entity("binary_sensor.vbr01_connected", "server-1", "Connected", {
        entity_category: "diagnostic",
      }),
      entity("binary_sensor.vbr01_health_ok", "server-1", "Health OK", {
        entity_category: "diagnostic",
      }),
      entity("sensor.vbr01_build_version", "server-1", "Build Version", {
        entity_category: "diagnostic",
      }),
      // Not diagnostics, unlike the rest of the server's
      entity(
        "sensor.vbr01_recovery_appliances_connected",
        "server-1",
        "Recovery Appliances Connected",
      ),
      entity(
        "sensor.vbr01_move_copy_sessions_awaiting_action",
        "server-1",
        "Move/Copy Sessions Awaiting Action",
      ),
      entity("sensor.veeam_license_vbr01_status", "license-1", "Status"),
      entity("sensor.veeam_license_vbr01_expiration_date", "license-1", "Expiration Date"),
      entity("binary_sensor.vbr_ha_vbr01_online", "cluster-1", "Online"),
      entity("binary_sensor.vbr_ha_vbr01_failover_in_progress", "cluster-1", "Failover In Progress"),
      entity("binary_sensor.vmware_backup_proxy_online", "proxy-1", "Online"),
      entity("binary_sensor.vmware_backup_proxy_enabled", "proxy-1", "Enabled"),
      entity("sensor.vmware_backup_proxy_type", "proxy-1", "Type", { entity_category: "diagnostic" }),
      entity("button.vmware_backup_proxy_disable", "proxy-1", "Disable", {
        entity_category: "config",
      }),
      entity("binary_sensor.backup_proxy_online", "proxy-2", "Online"),
      entity("sensor.wan_accelerator_01_cache_size", "wan-1", "Cache Size"),
      ...securityEntities("vbr_security_vbr01", "security-1"),
    ],
  };
}

/** The Security device's entities as integration 0.8.0 creates them, none of them diagnostic. */
function securityEntities(prefix, deviceId) {
  return [
    entity(`binary_sensor.${prefix}_malware_detected`, deviceId, "Malware Detected"),
    entity(`binary_sensor.${prefix}_best_practices`, deviceId, "Best Practices"),
    entity(`sensor.${prefix}_infected_objects`, deviceId, "Infected Objects"),
    entity(`sensor.${prefix}_suspicious_objects`, deviceId, "Suspicious Objects"),
    entity(`sensor.${prefix}_malware_events_24h`, deviceId, "Malware Events (24h)"),
    entity(`sensor.${prefix}_last_malware_event`, deviceId, "Last Malware Event"),
    entity(`sensor.${prefix}_best_practice_violations`, deviceId, "Best Practice Violations"),
    entity(`sensor.${prefix}_last_analyzer_run`, deviceId, "Last Analyzer Run"),
    entity(`button.${prefix}_run_security_analyzer`, deviceId, "Run Security Analyzer"),
  ];
}

/** The same registries from a server without any of the Security device. */
function withoutSecurity(data = registries()) {
  const ids = new Set(data.devices.filter((d) => d.model === "Security").map((d) => d.id));
  data.devices = data.devices.filter((d) => !ids.has(d.id));
  data.entities = data.entities.filter((e) => !ids.has(e.device_id));
  return data;
}

function headings(sections) {
  return sections.flatMap((s) => s.cards.filter((c) => c.type === "heading").map((c) => c.heading));
}

function entityCards(sections) {
  return sections.flatMap((s) => s.cards.filter((c) => c.entity));
}

function entityIdsIn(sections) {
  return entityCards(sections).map((c) => c.entity);
}

function sectionByHeading(sections, title) {
  return sections.find((s) => s.cards.some((c) => c.type === "heading" && c.heading === title));
}

function markdownIn(sections) {
  return sections.flatMap((s) => s.cards.filter((c) => c.type === "markdown").map((c) => c.content));
}

// ---------------------------------------------------------------------------------------------
// Views are named
// ---------------------------------------------------------------------------------------------

test("a generated view names itself", () => {
  // Home Assistant applies the generated config over the view's own keys, so a view strategy
  // that returns no title renders as "Unnamed view"
  for (const group of ["overview", "jobs", "repositories", "security", "infrastructure"]) {
    const view = buildView(group, registries(), {});
    assert.ok(view.title, `${group} should have a title`);
    assert.ok(view.icon, `${group} should have an icon`);
    assert.ok(view.path, `${group} should have a path`);
  }
});

test("the title, icon and path can be set in the strategy config", () => {
  // Renaming a strategy view in the visual editor drops the strategy, so the name has to be
  // settable here
  const view = buildView("jobs", registries(), {
    title: "Backups",
    icon: "mdi:shield",
    path: "veeam-backups",
  });

  assert.equal(view.title, "Backups");
  assert.equal(view.icon, "mdi:shield");
  assert.equal(view.path, "veeam-backups");
});

test("a dashboard keeps its per-view names even when a title is configured", () => {
  const dashboard = buildDashboard(registries(), { title: "Backups" });

  assert.deepEqual(
    dashboard.views.map((v) => v.title),
    ["Overview", "Jobs", "Repositories", "Security", "Infrastructure"],
  );
});

test("the theme can be set in the strategy config", () => {
  // The view editor is where you would normally pick a theme, and using it drops the strategy
  const view = buildView("jobs", registries(), { theme: "midnight" });

  assert.equal(view.theme, "midnight");
});

test("other view settings pass through too", () => {
  const view = buildView("jobs", registries(), {
    background: "var(--blue)",
    subview: true,
    visible: [{ user: "abc" }],
  });

  assert.equal(view.background, "var(--blue)");
  assert.equal(view.subview, true);
  assert.deepEqual(view.visible, [{ user: "abc" }]);
});

test("a view: block reaches the view verbatim, for anything not listed", () => {
  const view = buildView("jobs", registries(), { view: { theme: "midnight", top_margin: true } });

  assert.equal(view.theme, "midnight");
  assert.equal(view.top_margin, true);
});

test("a view: block cannot replace the generated content", () => {
  const view = buildView("jobs", registries(), {
    view: { type: "masonry", sections: [], badges: [], cards: [] },
  });

  assert.equal(view.type, "sections");
  assert.ok(view.sections.length, "the strategy decides what is on the view");
});

test("a theme on the dashboard strategy reaches every view", () => {
  const dashboard = buildDashboard(registries(), { theme: "midnight" });

  assert.ok(dashboard.views.every((v) => v.theme === "midnight"));
});

test("a dashboard keeps its own view names and paths", () => {
  // Four views cannot share one title, and two views cannot share one path
  const dashboard = buildDashboard(registries(), { title: "Backups", path: "backups" });

  assert.equal(new Set(dashboard.views.map((v) => v.path)).size, dashboard.views.length);
  assert.ok(!dashboard.views.some((v) => v.title === "Backups"));
});

test("builds a view per group", () => {
  const dashboard = buildDashboard(registries(), {});

  assert.deepEqual(
    dashboard.views.map((v) => v.path),
    ["overview", "jobs", "repositories", "security", "infrastructure"],
  );
  for (const view of dashboard.views) {
    assert.equal(view.type, "sections", `${view.path} should be a sections view`);
    assert.ok(view.sections.length, `${view.path} should not be empty`);
  }
});

test("the column count is configurable and applied", () => {
  const view = buildView("jobs", registries(), { columns: 2 });

  assert.equal(view.max_columns, 2);
  assert.equal(buildView("jobs", registries(), {}).max_columns, 3);
});

// ---------------------------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------------------------

test("the overview shows one tile per device", () => {
  const proxies = sectionByHeading(buildSections("overview", registries(), {}), "Backup proxies");
  const tiles = proxies.cards.filter((c) => c.entity);

  assert.equal(tiles.length, 2, "two proxies, two tiles — not one per entity");
});

test("no two overview tiles carry the same label", () => {
  // Several tiles from one device all named after the device is what made this unreadable
  const cards = entityCards(buildSections("overview", registries(), {}));
  const names = cards.map((c) => c.name);

  assert.equal(new Set(names).size, names.length, `duplicate labels in ${JSON.stringify(names)}`);
});

test("the overview leads a proxy with its Online sensor", () => {
  const proxies = sectionByHeading(buildSections("overview", registries(), {}), "Backup proxies");

  assert.ok(
    proxies.cards
      .filter((c) => c.entity)
      .every((c) => c.entity.endsWith("_online")),
    "online is what matters at a glance",
  );
});

test("the overview prefers Last Result over Status for jobs", () => {
  const jobs = sectionByHeading(buildSections("overview", registries(), {}), "Backup jobs");
  const ids = jobs.cards.filter((c) => c.entity).map((c) => c.entity);

  assert.deepEqual(
    ids,
    ["sensor.nightly_vms_last_result", "sensor.weekly_files_last_result"],
    "Status never reports failure, so Last Result comes first",
  );
});

test("section headings carry an icon", () => {
  const sections = buildSections("overview", registries(), {});
  const headingCards = sections.flatMap((s) => s.cards.filter((c) => c.type === "heading"));

  assert.ok(headingCards.length);
  assert.ok(headingCards.every((c) => c.icon), "a bare heading row looks unfinished");
});

test("buttons never reach the overview", () => {
  const ids = entityIdsIn(buildSections("overview", registries(), {}));

  assert.ok(!ids.some((id) => id.startsWith("button.")));
});

// ---------------------------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------------------------

test("server, cluster and license state become badges", () => {
  const view = buildView("overview", registries(), {});
  const entities = view.badges.map((b) => b.entity);

  assert.ok(entities.includes("binary_sensor.vbr01_connected"));
  assert.ok(entities.includes("binary_sensor.vbr_ha_vbr01_online"));
  assert.ok(entities.includes("sensor.veeam_license_vbr01_status"));
  assert.ok(view.badges.every((b) => b.type === "entity"));
});

test("badged models do not also take a section on the overview", () => {
  const titles = headings(buildSections("overview", registries(), {}));

  assert.ok(!titles.includes("Servers"), `got ${JSON.stringify(titles)}`);
  assert.ok(!titles.includes("Licensing"));
  assert.ok(!titles.includes("High availability"));
});

test("with badges off nothing is lost — they come back as sections", () => {
  const view = buildView("overview", registries(), { badges: false });
  const titles = headings(view.sections);

  assert.equal(view.badges, undefined);
  assert.ok(titles.includes("Servers"), `got ${JSON.stringify(titles)}`);
  assert.ok(titles.includes("Licensing"));
  assert.ok(titles.includes("High availability"));
});

test("badges are named for the entity, not the long device name", () => {
  const view = buildView("overview", registries(), {});
  const license = view.badges.find((b) => b.entity === "sensor.veeam_license_vbr01_status");

  assert.equal(license.name, "Status", "device names like Veeam License (vbr01) truncate");
});

// ---------------------------------------------------------------------------------------------
// Live summary
// ---------------------------------------------------------------------------------------------

test("the overview opens with a live summary", () => {
  const sections = buildSections("overview", registries(), {});
  const content = markdownIn(sections)[0];

  assert.ok(content, "expected a markdown summary");
  assert.match(content, /sensor\.nightly_vms_last_result/, "counts have to name the entities");
  assert.match(content, /failed/);
});

test("the summary is a template, so it does not go stale", () => {
  // Strategies run once per page load; anything state-dependent baked into the config would be
  // wrong minutes later
  const content = markdownIn(buildSections("overview", registries(), {}))[0];

  assert.match(content, /\{%\s*set/, "counting belongs in a template, not in the generator");
  assert.match(content, /map\('states'\)/);
});

test("the summary spans the full width", () => {
  const sections = buildSections("overview", registries(), { columns: 3 });

  assert.equal(sections[0].column_span, 3);
});

test("the repository threshold reaches the summary", () => {
  const content = markdownIn(buildSections("overview", registries(), { repository_warn_at: 70 }))[0];

  assert.match(content, /70/);
  assert.match(content, /sensor\.default_backup_repository_used_percentage/);
});

test("the summary counts the same entity the tiles show", () => {
  // Last Result is a diagnostic entity, so with diagnostics off it is not on the dashboard at
  // all — a headline counting it would read "no job results yet" beside four healthy tiles
  const data = registries();
  for (const entity of data.entities) {
    if (entity.entity_id.endsWith("_last_result")) entity.entity_category = "diagnostic";
  }

  const sections = buildSections("overview", data, {});
  const content = markdownIn(sections)[0];
  const tiles = sectionByHeading(sections, "Backup jobs")
    .cards.filter((c) => c.entity)
    .map((c) => c.entity);

  assert.ok(tiles.includes("sensor.nightly_vms_status"));
  for (const id of tiles) {
    assert.ok(content.includes(id), `${id} is on a tile but missing from the headline`);
  }
});

test("a running job is counted as running, not as a missing result", () => {
  // Status reports "Running" while a job runs, and that is the entity the headline counts
  const content = markdownIn(buildSections("overview", registries(), {}))[0];

  assert.match(content, /'running'/);
});

test("the summary can be turned off", () => {
  const sections = buildSections("overview", registries(), { summary: false });

  assert.equal(markdownIn(sections).length, 0);
});

test("no summary is generated for a system with neither jobs nor repositories", () => {
  const data = {
    devices: [device("proxy-1", "Backup Proxy", "Backup Proxy")],
    entities: [entity("binary_sensor.backup_proxy_online", "proxy-1", "Online")],
  };

  assert.equal(markdownIn(buildSections("overview", data, {})).length, 0);
});

// ---------------------------------------------------------------------------------------------
// Device sections
// ---------------------------------------------------------------------------------------------

test("each job becomes its own section", () => {
  assert.deepEqual(headings(buildSections("jobs", registries(), {})), [
    "Nightly VMs",
    "Weekly Files",
  ]);
});

test("tiles inside a device section use the entity's short name", () => {
  const section = sectionByHeading(buildSections("jobs", registries(), {}), "Nightly VMs");
  const names = section.cards.filter((c) => c.entity).map((c) => c.name);

  assert.deepEqual(names, ["Status", "Last Result", "Target", "Last Run", "Start"]);
});

test("a renamed entity keeps the name the user gave it", () => {
  const data = registries();
  data.entities[0].name = "Current state";

  const section = sectionByHeading(buildSections("jobs", data, {}), "Nightly VMs");

  assert.ok(section.cards.some((c) => c.name === "Current state"));
});

test("an entity with no registry name falls back to its object id", () => {
  const data = {
    devices: [device("job-1", "Nightly VMs", "Backup Job")],
    entities: [entity("sensor.nightly_vms_last_result", "job-1", null)],
  };

  const section = buildSections("jobs", data, {})[0];

  assert.equal(section.cards.find((c) => c.entity).name, "Last Result");
});

test("states come before buttons, and diagnostics last", () => {
  const section = sectionByHeading(
    buildSections("jobs", registries(), { include_diagnostics: true }),
    "Nightly VMs",
  );
  const ids = section.cards.filter((c) => c.entity).map((c) => c.entity);

  assert.ok(
    ids.indexOf("sensor.nightly_vms_last_result") < ids.indexOf("button.nightly_vms_start"),
    "a state should lead the card list, not a button",
  );
  assert.ok(
    ids.indexOf("button.nightly_vms_start") < ids.indexOf("sensor.nightly_vms_type"),
    "diagnostics belong last",
  );
});

test("Status and Last Result lead a job section in that order", () => {
  const section = sectionByHeading(buildSections("jobs", registries(), {}), "Nightly VMs");
  const ids = section.cards.filter((c) => c.entity).map((c) => c.entity);

  assert.equal(ids[0], "sensor.nightly_vms_status");
  assert.equal(ids[1], "sensor.nightly_vms_last_result");
});

test("used space is a gauge, not a percentage on a tile", () => {
  const section = sectionByHeading(
    buildSections("repositories", registries(), { repository_warn_at: 80 }),
    "Default Backup Repository",
  );
  const card = section.cards.find((c) => c.entity && c.entity.endsWith("_used_percentage"));

  assert.equal(card.type, "gauge");
  assert.equal(card.severity.yellow, 80, "the threshold should colour the gauge");
  assert.equal(card.min, 0);
  assert.equal(card.max, 100);
  assert.ok(card.severity.red > card.severity.yellow);
});

test("the gauge leads its section", () => {
  const section = sectionByHeading(
    buildSections("repositories", registries(), {}),
    "Default Backup Repository",
  );
  const cards = section.cards.filter((c) => c.entity);

  assert.equal(cards[0].type, "gauge", "a gauge between two tiles reads as a mistake");
});

test("the gauge is not labelled Used Percentage", () => {
  const section = sectionByHeading(
    buildSections("repositories", registries(), {}),
    "Default Backup Repository",
  );
  const card = section.cards.find((c) => c.type === "gauge");

  assert.equal(card.name, "Used space");
});

test("a renamed used-space entity keeps the user's name on the gauge", () => {
  const data = registries();
  const used = data.entities.find((e) => e.entity_id.endsWith("_used_percentage"));
  used.name = "Fullness";

  const section = sectionByHeading(buildSections("repositories", data, {}), "Default Backup Repository");

  assert.equal(section.cards.find((c) => c.type === "gauge").name, "Fullness");
});

test("button tiles hide their state", () => {
  // A button's state is the time it was last pressed, or nothing at all
  const section = sectionByHeading(buildSections("jobs", registries(), {}), "Nightly VMs");
  const button = section.cards.find((c) => c.entity === "button.nightly_vms_start");

  assert.equal(button.hide_state, true);
});

test("repositories and scale-out repositories share a view", () => {
  assert.deepEqual(headings(buildSections("repositories", registries(), {})), [
    "Default Backup Repository",
    "Main SOBR",
  ]);
});

test("infrastructure covers cluster, proxies, accelerators, server and license", () => {
  assert.deepEqual(headings(buildSections("infrastructure", registries(), {})), [
    "VBR-HA (vbr01)",
    "Backup Proxy",
    "VMware Backup Proxy",
    "WAN Accelerator 01",
    "vbr01",
    "Veeam License (vbr01)",
  ]);
});

test("proxy buttons appear on the proxy device", () => {
  const section = sectionByHeading(
    buildSections("infrastructure", registries(), {}),
    "VMware Backup Proxy",
  );

  assert.ok(section.cards.some((c) => c.entity === "button.vmware_backup_proxy_disable"));
});

// ---------------------------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------------------------

test("diagnostic entities are left out by default", () => {
  assert.ok(!entityIdsIn(buildSections("jobs", registries(), {})).includes("sensor.nightly_vms_type"));
});

test("diagnostic entities can be opted into", () => {
  const sections = buildSections("jobs", registries(), { include_diagnostics: true });

  assert.ok(entityIdsIn(sections).includes("sensor.nightly_vms_type"));
});

test("config entities such as job buttons are included by default", () => {
  assert.ok(
    entityIdsIn(buildSections("jobs", registries(), {})).includes("button.nightly_vms_start"),
  );
});

test("config entities can be excluded", () => {
  const sections = buildSections("jobs", registries(), { include_config: false });

  assert.ok(!entityIdsIn(sections).includes("button.nightly_vms_start"));
});

test("entities from other integrations are ignored", () => {
  const data = registries();
  data.devices.push(device("other-1", "Some Light", "Bulb"));
  data.entities.push(entity("light.some_light", "other-1", "Light", { platform: "hue" }));

  const everything = buildDashboard(data, {}).views.flatMap((v) => entityIdsIn(v.sections));

  assert.ok(!everything.includes("light.some_light"));
});

test("disabled and hidden entities are skipped", () => {
  const data = registries();
  data.entities.push(
    entity("sensor.nightly_vms_disabled", "job-1", "Disabled", { disabled_by: "user" }),
    entity("sensor.nightly_vms_hidden", "job-1", "Hidden", { hidden_by: "user" }),
  );

  const ids = entityIdsIn(buildSections("jobs", data, {}));

  assert.ok(!ids.includes("sensor.nightly_vms_disabled"));
  assert.ok(!ids.includes("sensor.nightly_vms_hidden"), "hiding something should keep it hidden");
});

test("hidden entities can be opted into, disabled ones never", () => {
  const data = registries();
  data.entities.push(
    entity("sensor.nightly_vms_disabled", "job-1", "Disabled", { disabled_by: "user" }),
    entity("sensor.nightly_vms_hidden", "job-1", "Hidden", { hidden_by: "user" }),
  );

  const ids = entityIdsIn(buildSections("jobs", data, { include_hidden: true }));

  assert.ok(ids.includes("sensor.nightly_vms_hidden"));
  assert.ok(
    !ids.includes("sensor.nightly_vms_disabled"),
    "a disabled entity has no state, so a tile for it would be broken",
  );
});

test("a disabled device is skipped even if its entities survive", () => {
  const data = registries();
  data.devices[0].disabled_by = "user";

  assert.deepEqual(headings(buildSections("jobs", data, {})), ["Weekly Files"]);
});

test("devices with no usable entities produce no section", () => {
  const data = registries();
  data.devices.push(device("job-3", "Ghost Job", "Backup Job"));

  assert.deepEqual(headings(buildSections("jobs", data, {})), ["Nightly VMs", "Weekly Files"]);
});

test("a user-renamed device uses the new name", () => {
  const data = registries();
  data.devices[0].name_by_user = "Renamed Job";

  assert.ok(headings(buildSections("jobs", data, {})).includes("Renamed Job"));
});

// ---------------------------------------------------------------------------------------------
// Multiple servers
// ---------------------------------------------------------------------------------------------

test("with one server, section titles are not suffixed", () => {
  assert.deepEqual(headings(buildSections("jobs", registries(), {})), [
    "Nightly VMs",
    "Weekly Files",
  ]);
});

test("with two servers, sections name which server they belong to", () => {
  const data = registries();
  data.devices.push(
    device("server-2", "vbr02", "Backup & Replication Server", ENTRY_2),
    device("job-9", "Nightly VMs", "Backup Job", ENTRY_2),
  );
  data.entities.push(
    entity("binary_sensor.vbr02_connected", "server-2", "Connected"),
    entity("sensor.nightly_vms_2_last_result", "job-9", "Last Result"),
  );

  const titles = headings(buildSections("jobs", data, {}));

  assert.ok(
    titles.includes("Nightly VMs — vbr01") && titles.includes("Nightly VMs — vbr02"),
    `identically named jobs should be distinguishable, got ${JSON.stringify(titles)}`,
  );
});

test("with two servers, badges say which server they describe", () => {
  const data = registries();
  data.devices.push(device("server-2", "vbr02", "Backup & Replication Server", ENTRY_2));
  data.entities.push(entity("binary_sensor.vbr02_connected", "server-2", "Connected"));

  const view = buildView("overview", data, {});
  const names = view.badges.map((b) => b.name);

  assert.ok(names.includes("Connected (vbr01)"), `got ${JSON.stringify(names)}`);
  assert.ok(names.includes("Connected (vbr02)"));
});

// ---------------------------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------------------------

test("an empty system explains itself instead of rendering blank", () => {
  const dashboard = buildDashboard({ devices: [], entities: [] }, {});

  assert.equal(dashboard.views.length, 1);
  const content = dashboard.views[0].cards[0].content;
  assert.match(content, /No Veeam entities found/);
  assert.match(content, /ha-veeam-br/, "should point at the integration that feeds it");
});

test("a system with only other integrations also gets the empty view", () => {
  const data = {
    devices: [device("x", "Light", "Bulb")],
    entities: [entity("light.x", "x", "Light", { platform: "hue" })],
  };

  assert.match(buildDashboard(data, {}).views[0].cards[0].content, /No Veeam entities found/);
});

test("views with nothing in them are dropped", () => {
  const data = {
    devices: [device("job-1", "Only Job", "Backup Job")],
    entities: [entity("sensor.only_job_last_result", "job-1", "Last Result")],
  };

  assert.deepEqual(
    buildDashboard(data, {}).views.map((v) => v.path),
    ["overview", "jobs"],
    "no repositories or infrastructure means no empty tabs",
  );
});

test("an unknown group falls back to the overview", () => {
  const sections = buildSections("nonsense", registries(), {});

  assert.equal(headings(sections)[0], "Backup jobs");
});

test("every generated card names a card type", () => {
  const dashboard = buildDashboard(registries(), {});

  for (const view of dashboard.views) {
    for (const section of view.sections) {
      assert.equal(section.type, "grid");
      for (const card of section.cards) {
        assert.ok(card.type, `card without a type: ${JSON.stringify(card)}`);
      }
    }
  }
});

test("nothing generated depends on the current state of an entity", () => {
  // The strategy runs once per page load. A colour or an order derived from live states would
  // be a stale snapshot for the rest of the session.
  const dashboard = buildDashboard(registries(), {});
  const json = JSON.stringify(dashboard);

  for (const key of ['"color"', '"state_color"']) {
    assert.ok(!json.includes(key), `${key} would freeze a live state into the config`);
  }
});

// ---------------------------------------------------------------------------------------------
// Device names and entity ID schemes
//
// The integration now names devices "VBR <kind> <name>". Home Assistant renames an existing
// device but keeps its entities' IDs, so an upgraded install has new device names over the old
// IDs, and only a new install gets IDs built from the prefixed names. All three must render.
// ---------------------------------------------------------------------------------------------

/** Device names as the integration now sets them, by device id. */
const NEW_NAMES = {
  "job-1": "VBR Job Nightly VMs",
  "job-2": "VBR Job Weekly Files",
  "repo-1": "VBR Default Backup Repository",
  "sobr-1": "VBR Main SOBR",
  "server-1": "VBR Server vbr01",
  "license-1": "VBR License vbr01",
  "cluster-1": "VBR HA Cluster VBR-HA",
  "proxy-1": "VBR VMware Backup Proxy",
  "proxy-2": "VBR Backup Proxy",
  "wan-1": "VBR WAN Accelerator 01",
  "security-1": "VBR Security vbr01",
};

/** Before the upgrade the IDs stay; after it only the device names change. */
function upgradedRegistries() {
  const data = registries();
  for (const d of data.devices) d.name = NEW_NAMES[d.id];
  return data;
}

/** A fresh install: every entity ID is slug(device name) + "_" + slug(entity name). */
function newRegistries() {
  const data = upgradedRegistries();
  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const names = new Map(data.devices.map((d) => [d.id, d.name]));

  for (const e of data.entities) {
    const [domain] = e.entity_id.split(".");
    e.entity_id = `${domain}.${slug(names.get(e.device_id))}_${slug(e.original_name)}`;
  }
  return data;
}

const SCHEMES = [
  ["old", registries],
  ["upgraded", upgradedRegistries],
  ["new", newRegistries],
];

test("the new-install fixture produces the IDs Home Assistant would", () => {
  const ids = newRegistries().entities.map((e) => e.entity_id);

  for (const id of [
    "sensor.vbr_job_nightly_vms_last_result",
    "binary_sensor.vbr_default_backup_repository_online",
    "binary_sensor.vbr_server_vbr01_connected",
    "sensor.vbr_license_vbr01_status",
    "binary_sensor.vbr_ha_cluster_vbr_ha_online",
    "button.vbr_vmware_backup_proxy_disable",
    "sensor.vbr_wan_accelerator_01_cache_size",
  ]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

for (const [scheme, fixture] of SCHEMES) {
  test(`${scheme} scheme: job and repository titles drop the VBR prefix and kind`, () => {
    assert.deepEqual(headings(buildSections("jobs", fixture(), {})), [
      "Nightly VMs",
      "Weekly Files",
    ]);
    assert.deepEqual(headings(buildSections("repositories", fixture(), {})), [
      "Default Backup Repository",
      "Main SOBR",
    ]);
  });

  test(`${scheme} scheme: the overview picks the same kind of entity for every device`, () => {
    const data = fixture();
    const sections = buildSections("overview", data, {});
    const idOf = (deviceId, name) =>
      data.entities.find((e) => e.device_id === deviceId && e.original_name === name).entity_id;

    const ids = entityIdsIn(sections);
    for (const [deviceId, name] of [
      ["job-1", "Last Result"],
      ["job-2", "Last Result"],
      ["repo-1", "Used Percentage"],
      ["sobr-1", "Extent Count"],
      ["proxy-1", "Online"],
      ["proxy-2", "Online"],
      ["wan-1", "Cache Size"],
    ]) {
      assert.ok(ids.includes(idOf(deviceId, name)), `${deviceId} should lead with ${name}`);
    }
  });

  test(`${scheme} scheme: overview tiles are named for the device, without the prefix`, () => {
    const names = entityCards(buildSections("overview", fixture(), {})).map((c) => c.name);

    assert.ok(names.includes("Nightly VMs"), `got ${JSON.stringify(names)}`);
    assert.ok(names.every((name) => !name.startsWith("VBR ")), `got ${JSON.stringify(names)}`);
  });

  test(`${scheme} scheme: server, cluster, security and license badges are found`, () => {
    const data = fixture();
    const badges = buildView("overview", data, {}).badges.map((b) => b.entity);
    const expected = data.entities
      .filter((e) =>
        [
          "Connected",
          "Health OK",
          "Online",
          "Failover In Progress",
          "Status",
          "Expiration Date",
          "Malware Detected",
          "Best Practices",
        ].includes(e.original_name),
      )
      .filter((e) => ["server-1", "cluster-1", "license-1", "security-1"].includes(e.device_id))
      .map((e) => e.entity_id);

    assert.deepEqual([...badges].sort(), [...expected].sort());
  });

  test(`${scheme} scheme: the summary and the gauge find their entities`, () => {
    const data = fixture();
    const used = data.entities.find((e) => e.original_name === "Used Percentage").entity_id;
    const lastResult = data.entities.find(
      (e) => e.device_id === "job-1" && e.original_name === "Last Result",
    ).entity_id;

    const content = markdownIn(buildSections("overview", data, {}))[0];
    assert.ok(content.includes(used));
    assert.ok(content.includes(lastResult));

    const repos = buildSections("repositories", data, {});
    assert.equal(repos[0].cards.find((c) => c.entity === used).type, "gauge");
  });

  test(`${scheme} scheme: tile names are the entity's own, with or without a registry name`, () => {
    const data = fixture();
    for (const e of data.entities) e.original_name = null;

    const section = buildSections("jobs", data, {})[0];
    const names = section.cards.filter((c) => c.entity).map((c) => c.name);

    assert.deepEqual(names, ["Status", "Last Result", "Target", "Last Run", "Start"]);
  });
}

test("infrastructure titles on a new install", () => {
  // License and cluster keep their kind: both are named after the server, and "vbr01" three
  // times over would not say which is which
  assert.deepEqual(headings(buildSections("infrastructure", newRegistries(), {})), [
    "HA Cluster VBR-HA",
    "Backup Proxy",
    "VMware Backup Proxy",
    "WAN Accelerator 01",
    "vbr01",
    "License vbr01",
  ]);
});

test("the kind is dropped only where it is a lead-in, not part of the name", () => {
  const data = {
    devices: [
      device("proxy-1", "VBR Proxy proxy01", "Backup Proxy"),
      device("proxy-2", "VBR VMware Backup Proxy", "Backup Proxy"),
      device("job-1", "VBR Job 5", "Backup Job"),
      device("wan-1", "VBR WAN Accelerator wan01", "WAN Accelerator"),
    ],
    entities: [
      entity("binary_sensor.vbr_proxy_proxy01_online", "proxy-1", "Online"),
      entity("binary_sensor.vbr_vmware_backup_proxy_online", "proxy-2", "Online"),
      entity("sensor.vbr_job_5_status", "job-1", "Status"),
      entity("sensor.vbr_wan_accelerator_wan01_cache_size", "wan-1", "Cache Size"),
    ],
  };

  const titles = headings(buildDashboard(data, {}).views.flatMap((v) => v.sections));

  assert.ok(titles.includes("proxy01"), `got ${JSON.stringify(titles)}`);
  assert.ok(titles.includes("VMware Backup Proxy"));
  assert.ok(titles.includes("wan01"));
  assert.ok(titles.includes("Job 5"), "a bare number is no name");
});

test("a user-renamed device keeps its name verbatim, prefix and all", () => {
  const data = newRegistries();
  data.devices[0].name_by_user = "VBR Job Critical";

  assert.ok(headings(buildSections("jobs", data, {})).includes("VBR Job Critical"));
});

test("with two servers on a new install, sections name the server without the prefix", () => {
  const data = newRegistries();
  data.devices.push(
    device("server-2", "VBR Server vbr02", "Backup & Replication Server", ENTRY_2),
    device("job-9", "VBR Job Nightly VMs", "Backup Job", ENTRY_2),
  );
  data.entities.push(
    entity("binary_sensor.vbr_server_vbr02_connected", "server-2", "Connected", {
      entity_category: "diagnostic",
    }),
    entity("sensor.vbr_job_nightly_vms_last_result_2", "job-9", "Last Result"),
  );

  const titles = headings(buildSections("jobs", data, {}));

  assert.ok(titles.includes("Nightly VMs — vbr01"), `got ${JSON.stringify(titles)}`);
  assert.ok(titles.includes("Nightly VMs — vbr02"));
});

// ---------------------------------------------------------------------------------------------
// Collisions and renamed IDs
// ---------------------------------------------------------------------------------------------

test("an entity ID with a collision suffix is still recognised", () => {
  // Seen on a live install: the VB365 integration had a Default Backup Repository device too,
  // so Home Assistant appended _2 to this integration's IDs
  const data = {
    devices: [device("repo-1", "Default Backup Repository", "Backup Repository")],
    entities: [
      entity("sensor.default_backup_repository_used_percentage_2", "repo-1", null),
      entity("binary_sensor.default_backup_repository_online_2", "repo-1", null),
      entity("binary_sensor.default_backup_repository_immutable_2", "repo-1", null),
    ],
  };

  const sections = buildSections("repositories", data, {});
  const cards = sections[0].cards.filter((c) => c.entity);

  assert.equal(cards[0].type, "gauge");
  assert.equal(cards[0].entity, "sensor.default_backup_repository_used_percentage_2");
  assert.deepEqual(
    cards.slice(1).map((c) => c.name),
    ["Online", "Immutable"],
    "the _2 is not part of the name",
  );
  assert.match(
    markdownIn(buildSections("overview", data, {}))[0],
    /used_percentage_2/,
    "the summary counts it too",
  );
});

test("a collision suffix on a job still leads with Last Result", () => {
  const data = {
    devices: [device("job-1", "VBR Job Nightly VMs", "Backup Job")],
    entities: [
      entity("sensor.vbr_job_nightly_vms_status_2", "job-1", "Status"),
      entity("sensor.vbr_job_nightly_vms_last_result_3", "job-1", "Last Result"),
    ],
  };

  const jobs = sectionByHeading(buildSections("overview", data, {}), "Backup jobs");

  assert.equal(jobs.cards.find((c) => c.entity).entity, "sensor.vbr_job_nightly_vms_last_result_3");
});

test("an entity whose ID the user changed is found by its own name", () => {
  const data = registries();
  const lastResult = data.entities.find((e) => e.entity_id === "sensor.nightly_vms_last_result");
  lastResult.entity_id = "sensor.nightly_outcome";

  const jobs = sectionByHeading(buildSections("overview", data, {}), "Backup jobs");

  assert.ok(jobs.cards.some((c) => c.entity === "sensor.nightly_outcome"));
});

test("IDs from a live upgraded install", () => {
  // The registry as it was on a real install after the device rename: old IDs, new names
  const data = {
    devices: [
      device("server-1", "VBR Server vbr-vsa-01", "Backup & Replication Server"),
      device("license-1", "VBR License vbr-vsa-01", "License"),
      device("repo-1", "VBR Repository Temp Local", "Backup Repository"),
      device("job-1", "VBR Job Websites", "Backup Job"),
    ],
    entities: [
      entity("binary_sensor.vbr_vsa_01_health_ok", "server-1", "Health OK", {
        entity_category: "diagnostic",
      }),
      entity("binary_sensor.vbr_vsa_01_connected", "server-1", "Connected", {
        entity_category: "diagnostic",
      }),
      entity("sensor.vbr_vsa_01_last_successful_poll", "server-1", "Last Successful Poll", {
        entity_category: "diagnostic",
      }),
      entity(
        "binary_sensor.veeam_license_vbr_vsa_01_jonah_home_auto_update_enabled",
        "license-1",
        "Auto Update Enabled",
        { entity_category: "diagnostic" },
      ),
      entity("sensor.veeam_license_status", "license-1", "Status"),
      entity("sensor.veeam_license_edition", "license-1", "Edition", {
        entity_category: "diagnostic",
      }),
      entity("sensor.veeam_license_expiration_date", "license-1", "Expiration Date"),
      entity(
        "sensor.veeam_license_vbr_vsa_01_jonah_home_instances_used_percentage",
        "license-1",
        "Instances Used Percentage",
      ),
      entity("sensor.temp_local_repository_capacity", "repo-1", "Capacity"),
      entity("sensor.websites_last_result", "job-1", "Last Result"),
      entity("button.websites_start", "job-1", "Start", { entity_category: "config" }),
    ],
  };

  const view = buildView("overview", data, {});
  assert.deepEqual(
    view.badges.map((b) => b.entity),
    [
      "binary_sensor.vbr_vsa_01_connected",
      "binary_sensor.vbr_vsa_01_health_ok",
      "sensor.veeam_license_status",
      "sensor.veeam_license_expiration_date",
    ],
  );

  const tiles = entityIdsIn(view.sections);
  assert.ok(tiles.includes("sensor.websites_last_result"));
  assert.ok(tiles.includes("sensor.temp_local_repository_capacity"));

  const infra = headings(buildSections("infrastructure", data, {}));
  assert.deepEqual(infra, ["vbr-vsa-01", "License vbr-vsa-01"]);

  // An instances percentage is not a repository's used space and gets no gauge
  const license = sectionByHeading(buildSections("infrastructure", data, {}), "License vbr-vsa-01");
  assert.ok(license.cards.every((c) => c.type !== "gauge"));
});

// ---------------------------------------------------------------------------------------------
// Server health
// ---------------------------------------------------------------------------------------------

test("Connected and Health OK are shown although the integration files them as diagnostics", () => {
  // Otherwise the server has nothing on the default dashboard, and "is it answering?" is lost
  const view = buildView("overview", registries(), {});
  const badges = view.badges.map((b) => b.entity);

  assert.ok(badges.includes("binary_sensor.vbr01_connected"));
  assert.ok(badges.includes("binary_sensor.vbr01_health_ok"));

  const server = sectionByHeading(buildSections("infrastructure", registries(), {}), "vbr01");
  const ids = server.cards.filter((c) => c.entity).map((c) => c.entity);
  assert.deepEqual(ids.slice(0, 2), ["binary_sensor.vbr01_connected", "binary_sensor.vbr01_health_ok"]);
  assert.ok(!ids.includes("sensor.vbr01_build_version"), "other diagnostics stay out");
});

test("with badges off, the server tile is Connected", () => {
  const view = buildView("overview", newRegistries(), { badges: false });
  const servers = sectionByHeading(view.sections, "Servers");

  assert.equal(servers.cards.find((c) => c.entity).entity, "binary_sensor.vbr_server_vbr01_connected");
});

test("failing endpoints are listed while Health OK is off", () => {
  for (const fixture of [registries, newRegistries]) {
    const data = fixture();
    const health = data.entities.find((e) => e.original_name === "Health OK").entity_id;
    const server = buildSections("infrastructure", data, {}).find((s) =>
      s.cards.some((c) => c.entity === health),
    );
    const note = server.cards.find(
      (c) => c.type === "markdown" && c.content.includes("failed_endpoints"),
    );

    assert.ok(note, "expected a failed-endpoints note");
    assert.match(note.content, new RegExp(`state_attr\\('${health}', 'failed_endpoints'\\)`));
    assert.deepEqual(note.visibility, [{ condition: "state", entity: health, state: "off" }]);
  }
});

test("no failed-endpoints note without a Health OK sensor", () => {
  const data = registries();
  data.entities = data.entities.filter((e) => e.original_name !== "Health OK");

  const sections = buildSections("infrastructure", data, {});

  assert.ok(!markdownIn(sections).some((content) => content.includes("failed_endpoints")));
});

test("the headline counts unavailable jobs and repositories", () => {
  // A job or repository whose endpoint failed goes unavailable instead of showing stale data;
  // "all succeeded" or "all below 85%" would then be claiming something nobody knows
  const content = markdownIn(buildSections("overview", registries(), {}))[0];

  assert.match(content, /'unavailable'/);
  assert.match(content, /unavailable\./);
  assert.match(content, /reporting repositories/);
});

// ---------------------------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------------------------

/** A second server with its own Security device. */
function twoServersWithSecurity() {
  const data = newRegistries();
  data.devices.push(
    device("server-2", "VBR Server vbr02", "Backup & Replication Server", ENTRY_2),
    device("security-2", "VBR Security vbr02", "Security", ENTRY_2),
  );
  data.entities.push(
    entity("binary_sensor.vbr_server_vbr02_connected", "server-2", "Connected", {
      entity_category: "diagnostic",
    }),
    ...securityEntities("vbr_security_vbr02", "security-2"),
  );
  return data;
}

test("the new-install fixture produces the live Security and server IDs", () => {
  // As seen on a live 0.8.0 install, with vbr-vsa-01 in place of vbr01
  const ids = newRegistries().entities.map((e) => e.entity_id);

  for (const id of [
    "binary_sensor.vbr_security_vbr01_malware_detected",
    "binary_sensor.vbr_security_vbr01_best_practices",
    "sensor.vbr_security_vbr01_malware_events_24h",
    "button.vbr_security_vbr01_run_security_analyzer",
    "sensor.vbr_server_vbr01_recovery_appliances_connected",
    "sensor.vbr_server_vbr01_move_copy_sessions_awaiting_action",
    "sensor.vbr_job_nightly_vms_target",
  ]) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

for (const [scheme, fixture] of SCHEMES) {
  test(`${scheme} scheme: a Security section per server, in reading order`, () => {
    const sections = buildSections("security", fixture(), {});

    assert.deepEqual(headings(sections), ["Security vbr01"], "named after the server, kind kept");
    const names = sections[0].cards.filter((c) => c.entity).map((c) => c.name);
    assert.deepEqual(names, [
      "Malware Detected",
      "Best Practices",
      "Infected Objects",
      "Suspicious Objects",
      "Best Practice Violations",
      "Malware Events (24h)",
      "Last Malware Event",
      "Last Analyzer Run",
      "Run Security Analyzer",
    ]);
  });

  test(`${scheme} scheme: the headline raises malware, best practices and move/copy`, () => {
    const data = fixture();
    const idOf = (name) => data.entities.find((e) => e.original_name === name).entity_id;
    const content = markdownIn(buildSections("overview", data, {}))[0];

    assert.ok(content.includes(idOf("Malware Detected")));
    assert.ok(content.includes(idOf("Best Practices")));
    assert.ok(content.includes(idOf("Move/Copy Sessions Awaiting Action")));
  });

  test(`${scheme} scheme: a job's Target is found and shown`, () => {
    const data = fixture();
    const target = data.entities.find(
      (e) => e.device_id === "job-1" && e.original_name === "Target",
    ).entity_id;

    assert.ok(entityIdsIn(buildSections("jobs", data, {})).includes(target));
  });
}

test("the Security view is named", () => {
  const view = buildView("security", registries(), {});

  assert.equal(view.title, "Security");
  assert.equal(view.path, "security");
  assert.equal(view.icon, "mdi:shield-lock");
});

test("the Security section opens with a banner per problem, shown only while it is on", () => {
  const section = buildSections("security", newRegistries(), {})[0];
  const [first, malware, practices] = section.cards;
  const malwareId = "binary_sensor.vbr_security_vbr01_malware_detected";
  const practicesId = "binary_sensor.vbr_security_vbr01_best_practices";

  assert.equal(first.type, "heading");
  assert.equal(malware.type, "markdown");
  assert.match(malware.content, /alert-type="error"/);
  assert.ok(malware.content.includes(`state_attr('${malwareId}', 'infected')`));
  assert.deepEqual(malware.visibility, [{ condition: "state", entity: malwareId, state: "on" }]);

  assert.equal(practices.type, "markdown");
  assert.match(practices.content, /alert-type="warning"/);
  assert.ok(practices.content.includes(`state_attr('${practicesId}', 'violating')`));
  assert.deepEqual(practices.visibility, [
    { condition: "state", entity: practicesId, state: "on" },
  ]);
});

test("the problem sensors are plain tiles, left for Home Assistant to colour live", () => {
  // Problem reads red and OK does not — Home Assistant's own colouring for the problem device
  // class. A colour set here would be fixed at render time.
  const section = buildSections("security", newRegistries(), {})[0];
  const malware = section.cards.find(
    (c) => c.entity === "binary_sensor.vbr_security_vbr01_malware_detected",
  );

  assert.equal(malware.type, "tile");
  assert.equal(malware.color, undefined);
});

test("the analyzer button is on the Security section, last and without a state", () => {
  const section = buildSections("security", newRegistries(), {})[0];
  const button = section.cards.find(
    (c) => c.entity === "button.vbr_security_vbr01_run_security_analyzer",
  );

  assert.equal(button.hide_state, true);
  assert.equal(section.cards.filter((c) => c.entity).at(-1), button, "controls go last");
});

test("Security entities are shown with diagnostics off", () => {
  // The integration does not file them as diagnostics; this pins that nothing here does either
  const sections = buildSections("security", newRegistries(), { include_diagnostics: false });

  assert.equal(entityIdsIn(sections).length, 9);
});

test("Malware Detected and Best Practices become badges", () => {
  const view = buildView("overview", newRegistries(), {});
  const badges = view.badges.map((b) => b.entity);

  assert.ok(badges.includes("binary_sensor.vbr_security_vbr01_malware_detected"));
  assert.ok(badges.includes("binary_sensor.vbr_security_vbr01_best_practices"));
  assert.ok(!headings(view.sections).includes("Security"), "badged, so no overview section");
  assert.equal(
    view.badges.find((b) => b.entity.endsWith("_malware_detected")).name,
    "Malware Detected",
  );
});

test("badges run server, then security, then license", () => {
  const badges = buildView("overview", newRegistries(), {}).badges.map((b) => b.entity);
  const at = (suffix) => badges.findIndex((id) => id.endsWith(suffix));

  assert.ok(at("_health_ok") < at("_malware_detected"));
  assert.ok(at("_best_practices") < at("_expiration_date"));
});

test("with badges off, the overview has a Security tile per server", () => {
  const view = buildView("overview", newRegistries(), { badges: false });
  const tiles = sectionByHeading(view.sections, "Security").cards.filter((c) => c.entity);

  assert.deepEqual(
    tiles.map((c) => [c.entity, c.name]),
    [["binary_sensor.vbr_security_vbr01_malware_detected", "Security vbr01"]],
  );
});

test("without detected-object support, Best Practices leads the Security tile", () => {
  // Before API 1.3-rev2 the integration has no Malware Detected, only the analyzer and events
  const data = newRegistries();
  const missing = ["Malware Detected", "Infected Objects", "Suspicious Objects"];
  data.entities = data.entities.filter((e) => !missing.includes(e.original_name));

  const view = buildView("overview", data, { badges: false });
  const tile = sectionByHeading(view.sections, "Security").cards.find((c) => c.entity);
  assert.equal(tile.entity, "binary_sensor.vbr_security_vbr01_best_practices");

  const section = buildSections("security", data, {})[0];
  assert.equal(section.cards.filter((c) => c.type === "markdown").length, 1, "no malware banner");

  const content = markdownIn(view.sections)[0];
  assert.match(content, /No best practice violations/);
  assert.doesNotMatch(content, /No malware detected/, "nothing is known about detected objects");
});

test("the headline raises malware as an error and violations as a warning", () => {
  const content = markdownIn(buildSections("overview", newRegistries(), {}))[0];

  assert.match(content, /select\('is_state', 'on'\)/, "counted live, not at render time");
  assert.match(content, /<ha-alert alert-type="error" title="Malware detected">/);
  assert.match(content, /<ha-alert alert-type="warning" title="Best practices not followed">/);
  assert.match(content, /map\('state_attr', 'infected'\)/);
  assert.match(content, /No malware detected, and no best practice violations\./);
  assert.match(content, /Security state is unavailable/);
});

test("the security headline follows the job headline", () => {
  const content = markdownIn(buildSections("overview", newRegistries(), {}))[0];

  assert.ok(content.startsWith("{% set jobs"), "the job headline is still the heading");
  assert.ok(content.indexOf("set jobs =") < content.indexOf("set malware ="));
});

test("security alone still makes a headline", () => {
  const data = {
    devices: [device("security-1", "VBR Security vbr01", "Security")],
    entities: securityEntities("vbr_security_vbr01", "security-1"),
  };

  const content = markdownIn(buildSections("overview", data, {}))[0];
  assert.match(content, /binary_sensor\.vbr_security_vbr01_malware_detected/);
});

test("the summary option also turns the security headline off", () => {
  const sections = buildSections("overview", newRegistries(), { summary: false });

  assert.equal(markdownIn(sections).length, 0);
});

// ---------------------------------------------------------------------------------------------
// Without a Security device
// ---------------------------------------------------------------------------------------------

test("without a Security device there is no Security view", () => {
  const dashboard = buildDashboard(withoutSecurity(), {});

  assert.deepEqual(
    dashboard.views.map((v) => v.path),
    ["overview", "jobs", "repositories", "infrastructure"],
  );
  assert.equal(buildView("security", withoutSecurity(), {}), null);
});

test("without a Security device the overview says nothing about security", () => {
  const view = buildView("overview", withoutSecurity(), {});

  assert.doesNotMatch(markdownIn(view.sections)[0], /malware|best practice/i);
  assert.ok(!view.badges.some((b) => /malware|best_practices/.test(b.entity)));

  const off = buildView("overview", withoutSecurity(), { badges: false });
  assert.ok(!headings(off.sections).includes("Security"));
});

test("a Security device with every entity disabled leaves no empty section", () => {
  const data = registries();
  for (const e of data.entities) if (e.device_id === "security-1") e.disabled_by = "user";

  assert.equal(buildView("security", data, {}), null);
  assert.ok(!buildDashboard(data, {}).views.some((v) => v.path === "security"));
});

test("a Security device with only the analyzer shows just that", () => {
  // An account without the role to read malware gets no malware entities at all
  const kept = [
    "Best Practices",
    "Best Practice Violations",
    "Last Analyzer Run",
    "Run Security Analyzer",
  ];
  const data = {
    devices: [device("security-1", "VBR Security vbr01", "Security")],
    entities: securityEntities("vbr_security_vbr01", "security-1").filter((e) =>
      kept.includes(e.original_name),
    ),
  };

  const section = buildSections("security", data, {})[0];
  assert.deepEqual(
    section.cards.filter((c) => c.entity).map((c) => c.name),
    kept,
  );
});

// ---------------------------------------------------------------------------------------------
// Security with several servers
// ---------------------------------------------------------------------------------------------

test("with two servers, each gets its own Security section, named once", () => {
  // "Security vbr01 — vbr01" would say the server twice
  assert.deepEqual(headings(buildSections("security", twoServersWithSecurity(), {})), [
    "Security vbr01",
    "Security vbr02",
  ]);
});

test("with two servers, security badges say which server they describe", () => {
  const names = buildView("overview", twoServersWithSecurity(), {}).badges.map((b) => b.name);

  for (const name of [
    "Malware Detected (vbr01)",
    "Malware Detected (vbr02)",
    "Best Practices (vbr01)",
    "Best Practices (vbr02)",
  ]) {
    assert.ok(names.includes(name), `missing ${name} in ${JSON.stringify(names)}`);
  }
});

test("with two servers, the headline counts both and says how many are affected", () => {
  const content = markdownIn(buildSections("overview", twoServersWithSecurity(), {}))[0];

  assert.match(content, /binary_sensor\.vbr_security_vbr01_malware_detected/);
  assert.match(content, /binary_sensor\.vbr_security_vbr02_malware_detected/);
  assert.match(content, /of \{\{ malware \| count \}\} servers/);
});

test("with two servers and badges off, Security tiles are not suffixed twice", () => {
  const view = buildView("overview", twoServersWithSecurity(), { badges: false });
  const names = sectionByHeading(view.sections, "Security")
    .cards.filter((c) => c.entity)
    .map((c) => c.name);

  assert.deepEqual(names, ["Security vbr01", "Security vbr02"]);
});

test("with two servers, a license title does not repeat its server either", () => {
  const titles = headings(buildSections("infrastructure", twoServersWithSecurity(), {}));

  assert.ok(titles.includes("License vbr01"), `got ${JSON.stringify(titles)}`);
  assert.ok(titles.includes("vbr02"), "the server is its own label");
});

// ---------------------------------------------------------------------------------------------
// Server: recovery appliances and move/copy sessions
// ---------------------------------------------------------------------------------------------

test("the server section shows move/copy sessions and recovery appliances after its health", () => {
  for (const fixture of [registries, newRegistries]) {
    const data = fixture();
    const connected = data.entities.find((e) => e.original_name === "Connected").entity_id;
    const server = buildSections("infrastructure", data, {}).find((s) =>
      s.cards.some((c) => c.entity === connected),
    );

    assert.deepEqual(
      server.cards.filter((c) => c.entity).map((c) => c.name),
      [
        "Connected",
        "Health OK",
        "Move/Copy Sessions Awaiting Action",
        "Recovery Appliances Connected",
      ],
    );
  }
});

test("move/copy sessions awaiting action raise a banner at the top of the server section", () => {
  const id = "sensor.vbr_server_vbr01_move_copy_sessions_awaiting_action";
  const server = sectionByHeading(buildSections("infrastructure", newRegistries(), {}), "vbr01");
  const banner = server.cards[1];

  assert.equal(banner.type, "markdown");
  assert.match(banner.content, /alert-type="warning"/);
  assert.ok(banner.content.includes(`state_attr('${id}', 'sessions')`));
  assert.match(banner.content, /veeam_br\.manage_move_copy_session/);
  assert.deepEqual(banner.visibility, [{ condition: "numeric_state", entity: id, above: 0 }]);
});

test("move/copy sessions awaiting action reach the headline", () => {
  const content = markdownIn(buildSections("overview", newRegistries(), {}))[0];

  assert.match(content, /sensor\.vbr_server_vbr01_move_copy_sessions_awaiting_action/);
  assert.match(content, /\{% if awaiting %\}<ha-alert alert-type="warning"/);
});

test("without the move/copy sensor there is no banner and no headline line", () => {
  const data = newRegistries();
  data.entities = data.entities.filter((e) => !e.entity_id.includes("move_copy"));

  const infra = markdownIn(buildSections("infrastructure", data, {}));
  assert.ok(!infra.some((content) => content.includes("move/copy")));
  assert.doesNotMatch(markdownIn(buildSections("overview", data, {}))[0], /awaiting/);
});

test("Recovery Appliances Connected is never taken for the server's Connected", () => {
  // Both end in _connected; only the binary sensor says whether the server answers
  const data = newRegistries();
  const appliances = "sensor.vbr_server_vbr01_recovery_appliances_connected";
  data.entities = data.entities.filter(
    (e) => e.entity_id !== "binary_sensor.vbr_server_vbr01_connected",
  );

  const badges = buildView("overview", data, {}).badges.map((b) => b.entity);
  assert.ok(!badges.includes(appliances));

  const view = buildView("overview", data, { badges: false });
  const servers = sectionByHeading(view.sections, "Servers");
  assert.notEqual(servers.cards.find((c) => c.entity).entity, appliances);
});

// ---------------------------------------------------------------------------------------------
// Job target
// ---------------------------------------------------------------------------------------------

test("a job's Target is shown although the integration files it as a diagnostic", () => {
  const section = sectionByHeading(buildSections("jobs", registries(), {}), "Nightly VMs");
  const ids = section.cards.filter((c) => c.entity).map((c) => c.entity);

  assert.equal(ids[2], "sensor.nightly_vms_target", "after Status and Last Result");
  assert.ok(!ids.includes("sensor.nightly_vms_type"), "other diagnostics stay out");
});

test("a job's Target sits with its states even with diagnostics on", () => {
  const section = sectionByHeading(
    buildSections("jobs", registries(), { include_diagnostics: true }),
    "Nightly VMs",
  );
  const ids = section.cards.filter((c) => c.entity).map((c) => c.entity);

  assert.ok(ids.indexOf("sensor.nightly_vms_target") < ids.indexOf("button.nightly_vms_start"));
});

test("a job's Target never stands in for its state on the overview", () => {
  // With no Last Result or Status shown, Target would otherwise become the job's one tile
  const data = registries();
  data.entities = data.entities.filter((e) => e.entity_id !== "sensor.weekly_files_last_result");

  const ids = entityIdsIn(buildSections("overview", data, {}));
  assert.ok(!ids.some((id) => id.endsWith("_target")), `got ${JSON.stringify(ids)}`);
});
