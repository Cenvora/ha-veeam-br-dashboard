/**
 * Tests for the dashboard strategy.
 *
 * Zero dependencies: node:test plus the module itself, which is plain ESM with no build step.
 * The registry fixtures mirror what Home Assistant returns for the ha-veeam-br integration,
 * including the entity_category and platform fields the filtering depends on.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { buildDashboard, buildSections } from "../veeam-br-dashboard.js";

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

function entity(entityId, deviceId, extra = {}) {
  return {
    entity_id: entityId,
    device_id: deviceId,
    platform: "veeam_br",
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
    ],
    entities: [
      entity("sensor.nightly_vms_last_result", "job-1"),
      entity("sensor.nightly_vms_status", "job-1"),
      entity("sensor.nightly_vms_type", "job-1", { entity_category: "diagnostic" }),
      entity("button.nightly_vms_start", "job-1", { entity_category: "config" }),
      entity("sensor.weekly_files_last_result", "job-2"),
      entity("sensor.default_backup_repository_used_percentage", "repo-1"),
      entity("sensor.default_backup_repository_online", "repo-1"),
      entity("sensor.main_sobr_extent_count", "sobr-1"),
      entity("binary_sensor.vbr01_connected", "server-1"),
      entity("sensor.veeam_license_vbr01_status", "license-1"),
      entity("sensor.veeam_license_vbr01_expiration_date", "license-1"),
      entity("binary_sensor.vbr_ha_vbr01_online", "cluster-1"),
      entity("binary_sensor.vbr_ha_vbr01_failover_in_progress", "cluster-1"),
    ],
  };
}

function sectionTitles(sections) {
  return sections.map((s) => s.cards[0].heading);
}

function entityIdsIn(sections) {
  return sections.flatMap((s) => s.cards.filter((c) => c.entity).map((c) => c.entity));
}

test("builds a view per group", () => {
  const dashboard = buildDashboard(registries(), {});

  assert.deepEqual(
    dashboard.views.map((v) => v.path),
    ["overview", "jobs", "repositories", "infrastructure"],
  );
  for (const view of dashboard.views) {
    assert.equal(view.type, "sections", `${view.path} should be a sections view`);
    assert.ok(view.sections.length, `${view.path} should not be empty`);
  }
});

test("each job becomes its own section", () => {
  const sections = buildSections("jobs", registries(), {});

  assert.deepEqual(sectionTitles(sections), ["Nightly VMs", "Weekly Files"]);
});

test("repositories and scale-out repositories share a view", () => {
  const sections = buildSections("repositories", registries(), {});

  assert.deepEqual(sectionTitles(sections), ["Default Backup Repository", "Main SOBR"]);
});

test("infrastructure covers cluster, server and license", () => {
  const sections = buildSections("infrastructure", registries(), {});

  assert.deepEqual(sectionTitles(sections), ["VBR-HA (vbr01)", "vbr01", "Veeam License (vbr01)"]);
});

test("diagnostic entities are left out by default", () => {
  const sections = buildSections("jobs", registries(), {});

  assert.ok(!entityIdsIn(sections).includes("sensor.nightly_vms_type"));
});

test("diagnostic entities can be opted into", () => {
  const sections = buildSections("jobs", registries(), { include_diagnostics: true });

  assert.ok(entityIdsIn(sections).includes("sensor.nightly_vms_type"));
});

test("config entities such as job buttons are included by default", () => {
  const sections = buildSections("jobs", registries(), {});

  assert.ok(entityIdsIn(sections).includes("button.nightly_vms_start"));
});

test("config entities can be excluded", () => {
  const sections = buildSections("jobs", registries(), { include_config: false });

  assert.ok(!entityIdsIn(sections).includes("button.nightly_vms_start"));
});

test("primary entities come before config and diagnostics", () => {
  const sections = buildSections("jobs", registries(), { include_diagnostics: true });
  const first = sections[0].cards.filter((c) => c.entity).map((c) => c.entity);

  assert.ok(
    first.indexOf("sensor.nightly_vms_last_result") < first.indexOf("button.nightly_vms_start"),
    "a state should lead the card list, not a button",
  );
  assert.ok(
    first.indexOf("button.nightly_vms_start") < first.indexOf("sensor.nightly_vms_type"),
    "diagnostics belong last",
  );
});

test("entities from other integrations are ignored", () => {
  const data = registries();
  data.devices.push(device("other-1", "Some Light", "Bulb"));
  data.entities.push(entity("light.some_light", "other-1", { platform: "hue" }));

  const dashboard = buildDashboard(data, {});
  const everything = dashboard.views.flatMap((v) => entityIdsIn(v.sections));

  assert.ok(!everything.includes("light.some_light"));
});

test("disabled and hidden entities are skipped", () => {
  const data = registries();
  data.entities.push(
    entity("sensor.nightly_vms_disabled", "job-1", { disabled_by: "user" }),
    entity("sensor.nightly_vms_hidden", "job-1", { hidden_by: "user" }),
  );

  const ids = entityIdsIn(buildSections("jobs", data, {}));

  assert.ok(!ids.includes("sensor.nightly_vms_disabled"));
  assert.ok(!ids.includes("sensor.nightly_vms_hidden"), "hiding something should keep it hidden");
});

test("hidden entities can be opted into, disabled ones never", () => {
  const data = registries();
  data.entities.push(
    entity("sensor.nightly_vms_disabled", "job-1", { disabled_by: "user" }),
    entity("sensor.nightly_vms_hidden", "job-1", { hidden_by: "user" }),
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

  assert.deepEqual(sectionTitles(buildSections("jobs", data, {})), ["Weekly Files"]);
});

test("devices with no usable entities produce no section", () => {
  const data = registries();
  data.devices.push(device("job-3", "Ghost Job", "Backup Job"));

  assert.deepEqual(sectionTitles(buildSections("jobs", data, {})), ["Nightly VMs", "Weekly Files"]);
});

test("a user-renamed device uses the new name", () => {
  const data = registries();
  data.devices[0].name_by_user = "Renamed Job";

  assert.ok(sectionTitles(buildSections("jobs", data, {})).includes("Renamed Job"));
});

test("with one server, section titles are not suffixed", () => {
  const sections = buildSections("jobs", registries(), {});

  assert.deepEqual(sectionTitles(sections), ["Nightly VMs", "Weekly Files"]);
});

test("with two servers, sections name which server they belong to", () => {
  const data = registries();
  data.devices.push(
    device("server-2", "vbr02", "Backup & Replication Server", ENTRY_2),
    device("job-9", "Nightly VMs", "Backup Job", ENTRY_2),
  );
  data.entities.push(
    entity("binary_sensor.vbr02_connected", "server-2"),
    entity("sensor.nightly_vms_2_last_result", "job-9"),
  );

  const titles = sectionTitles(buildSections("jobs", data, {}));

  assert.ok(
    titles.includes("Nightly VMs — vbr01") && titles.includes("Nightly VMs — vbr02"),
    `identically named jobs should be distinguishable, got ${JSON.stringify(titles)}`,
  );
});

test("the overview leads with jobs and stays compact", () => {
  const sections = buildSections("overview", registries(), {});

  assert.equal(sectionTitles(sections)[0], "Backup jobs");
  // Two tiles per job at most, rather than every entity
  const jobTiles = sections[0].cards.filter((c) => c.entity);
  assert.ok(jobTiles.length <= 4, `expected a summary, got ${jobTiles.length} tiles`);
  assert.ok(jobTiles.every((c) => c.name), "overview tiles should be named for their device");
});

test("the overview prefers Last Result over Status for jobs", () => {
  const sections = buildSections("overview", registries(), {});
  const ids = entityIdsIn([sections[0]]);

  assert.equal(
    ids[0],
    "sensor.nightly_vms_last_result",
    "Status never reports failure, so Last Result comes first",
  );
});

test("an empty system explains itself instead of rendering blank", () => {
  const dashboard = buildDashboard({ devices: [], entities: [] }, {});

  assert.equal(dashboard.views.length, 1);
  const content = dashboard.views[0].cards[0].content;
  assert.match(content, /No Veeam entities found/);
  assert.match(content, /ha-veeam-br/, "should point at the integration that feeds it");
});

test("a system with only other integrations also gets the empty view", () => {
  const data = { devices: [device("x", "Light", "Bulb")], entities: [entity("light.x", "x", { platform: "hue" })] };

  assert.match(buildDashboard(data, {}).views[0].cards[0].content, /No Veeam entities found/);
});

test("views with nothing in them are dropped", () => {
  const data = {
    devices: [device("job-1", "Only Job", "Backup Job")],
    entities: [entity("sensor.only_job_last_result", "job-1")],
  };

  assert.deepEqual(
    buildDashboard(data, {}).views.map((v) => v.path),
    ["overview", "jobs"],
    "no repositories or infrastructure means no empty tabs",
  );
});

test("an unknown group falls back to the overview", () => {
  const sections = buildSections("nonsense", registries(), {});

  assert.equal(sectionTitles(sections)[0], "Backup jobs");
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

test("the warning threshold reaches the overview text", () => {
  const sections = buildSections("overview", registries(), { repository_warn_at: 70 });
  const notes = sections.find((s) => s.cards.some((c) => c.type === "markdown"));

  assert.match(notes.cards.find((c) => c.type === "markdown").content, /70%/);
});
