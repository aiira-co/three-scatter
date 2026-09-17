/**
 * Zero-dependency regression smoke test. Runs against the built `dist`, so:
 *   npm run build && npm run test:smoke
 *
 * Each case pins a behaviour that was previously wrong and is cheap to
 * reintroduce. Exits non-zero on failure so a release can be gated on it.
 */
const THREE = require('three');
const { HeightmapScatterSystem } = require('../dist/systems/HeightmapScatterSystem.js');
const { BaseScatterSystem } = require('../dist/core/BaseScatterSystem.js');
const { InstancePool } = require('../dist/utils/InstancePool.js');

let failures = 0;
function check(name, pass, detail) {
  const status = pass ? 'PASS' : 'FAIL';
  console.log(status + '  ' + name + (detail ? '  [' + detail + ']' : ''));
  if (!pass) failures++;
}

const HM_SIZE = 64;
const heightMap = new Uint8Array(HM_SIZE * HM_SIZE * 4).fill(128);

function camera(x, z, yaw) {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
  cam.position.set(x, 5, z);
  cam.rotation.set(0, yaw || 0, 0);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  return cam;
}

function makeSystem(overrides) {
  const source = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  return new HeightmapScatterSystem(Object.assign({
    source,
    worldSize: 1000, worldSizeZ: 1000,
    worldOrigin: new THREE.Vector2(-500, -500),
    heightMapData: heightMap, heightMapSize: [HM_SIZE, HM_SIZE], heightMapScale: 1,
    density: 1, maxInstances: 47124, visibilityRange: 100, chunkSize: 20,
    alignToNormal: false, randomSeed: 7,
  }, overrides || {}));
}

function summarise(system) {
  let active = 0, empty = 0, instances = 0, visible = 0;
  for (const chunk of system.chunks.values()) {
    if (!chunk.isActive) continue;
    active++;
    instances += chunk.instances.length;
    if (chunk.instances.length === 0) empty++;
    if (chunk.isVisible !== false) visible++;
  }
  return { active, empty, instances, visible };
}

// --- 1. Instance pool: O(1) high-water mark, and no argument-limit blow-up ----
function poolCases() {
  let seed = 12345;
  const rnd = () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let mismatch = false;

  for (let trial = 0; trial < 200 && !mismatch; trial++) {
    const max = 1 + Math.floor(rnd() * 40);
    const pool = new InstancePool(max);
    const reference = new Set();
    const live = [];

    for (let step = 0; step < 400; step++) {
      if (rnd() < 0.5) {
        const id = pool.acquire();
        if (id !== null) {
          reference.add(id);
          live.push(id);
        }
      } else if (live.length > 0) {
        const id = live.splice(Math.floor(rnd() * live.length), 1)[0];
        pool.release(id);
        pool.release(id); // double release must be a no-op
        reference.delete(id);
      }
      const expected = reference.size === 0 ? -1 : Math.max.apply(null, Array.from(reference));
      if (pool.getHighestActiveId() !== expected) {
        mismatch = true;
        break;
      }
    }
  }
  check('InstancePool high-water mark matches a full scan', !mismatch);

  const big = new InstancePool(300000);
  for (let i = 0; i < 300000; i++) big.acquire();
  let threw = false;
  try {
    big.getHighestActiveId();
  } catch (e) {
    threw = true;
  }
  check('InstancePool survives 300k active instances', !threw);
}

// --- 2. LOD density must never rise with distance ----------------------------
function lodCases() {
  class Probe extends BaseScatterSystem {
    async initializeDistribution() {}
    updateChunks() {}
    populateChunk() {}
  }
  const source = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
  const probe = new Probe({
    source, density: 1, visibilityRange: 100,
    lod: {
      levels: [
        { distance: 0, densityMultiplier: 1 },
        { distance: 45, densityMultiplier: 0.55 },
        { distance: 75, densityMultiplier: 0.3 },
      ],
      blendDistance: 10,
    },
  });
  probe.isInitialized = true;
  probe.update(camera(0, 0));

  let previous = Infinity;
  let firstRise = null;
  for (let d = 0; d <= 120; d++) {
    const m = probe.getLODDensityMultiplier(0, d);
    if (m > previous + 1e-9 && firstRise === null) {
      firstRise = 'd=' + d + ': ' + previous.toFixed(3) + ' -> ' + m.toFixed(3);
    }
    previous = m;
  }
  check('LOD density is monotonic non-increasing', firstRise === null, firstRise || undefined);

  const near = probe.getLODDensityMultiplier(0, 8);
  check('chunk near the camera populates at full density', near === 1, 'd=8 => ' + near);
}

// --- 3. Retention: a camera turn must not discard placement -------------------
async function retentionCases() {
  for (const retained of [false, true]) {
    const base = {
      worldSize: 400, worldSizeZ: 400,
      worldOrigin: new THREE.Vector2(-200, -200),
      density: 0.01, maxInstances: 20000,
    };
    if (retained) base.chunkRetention = { enabled: true, unloadMargin: 0.25 };

    const system = makeSystem(base);
    await system.init();

    let populations = 0;
    const inner = system.populateChunk.bind(system);
    system.populateChunk = function () {
      populations++;
      return inner.apply(null, arguments);
    };

    system.update(camera(0, 0, 0));
    const baseline = populations;
    system.update(camera(0, 0, Math.PI));
    system.update(camera(0, 0, 0));
    const regenerated = populations - baseline;

    if (retained) {
      check('retention: two camera turns regenerate nothing', regenerated === 0, regenerated + ' re-populations');
    } else {
      check('baseline still regenerates on turn (guards the comparison)', regenerated > 0, regenerated + ' re-populations');
    }
  }

  // Retained past the unload radius, but never drawn past visibilityRange.
  const system = makeSystem({ chunkRetention: { enabled: true, unloadMargin: 0.25 } });
  await system.init();
  system.update(camera(0, 0));
  system.update(camera(-40, 0));

  let beyondRange = 0;
  let beyondRangeVisible = 0;
  const eye = new THREE.Vector3(-40, 5, 0);
  const centre = new THREE.Vector3();
  for (const chunk of system.chunks.values()) {
    if (!chunk.isActive) continue;
    chunk.bounds.getCenter(centre);
    if (Math.hypot(centre.x - eye.x, centre.z - eye.z) > 100) {
      beyondRange++;
      if (chunk.isVisible !== false) beyondRangeVisible++;
    }
  }
  check(
    'hysteresis-band chunks stay resident but undrawn',
    beyondRange > 0 && beyondRangeVisible === 0,
    beyondRange + ' beyond range, ' + beyondRangeVisible + ' visible'
  );
}

// --- 4. Capacity: release before populate; starvation repairs, never thrashes -
async function capacityCases() {
  const system = makeSystem();
  system.setFrustumCulling(false); // full disc, so capacity actually binds
  await system.init();

  system.update(camera(0, 0));
  const before = summarise(system);
  system.update(camera(300, 300));
  const after = summarise(system);

  check(
    'camera jump keeps every chunk fully populated',
    after.empty === 0 && after.instances >= before.instances * 0.99,
    before.instances + ' -> ' + after.instances + ', ' + after.empty + ' empty'
  );

  const tight = makeSystem({ maxInstances: 8000 });
  tight.setFrustumCulling(false);
  await tight.init();
  tight.update(camera(0, 0));
  tight.update(camera(0, 0));
  const settledA = summarise(tight);
  tight.update(camera(0, 0));
  const settledB = summarise(tight);

  check(
    'over-subscribed pool settles instead of rebuilding forever',
    settledA.instances === settledB.instances && settledA.active === settledB.active,
    settledA.instances + ' then ' + settledB.instances
  );

  tight.config.visibilityRange = 40;
  tight.update(camera(0, 0));
  tight.config.visibilityRange = 100;
  tight.update(camera(0, 0));
  tight.update(camera(0, 0));
  const recovered = summarise(tight).instances;
  check(
    'starved chunks repair once capacity frees',
    recovered >= settledB.instances * 0.95,
    'recovered to ' + recovered
  );
}

(async () => {
  poolCases();
  lodCases();
  await retentionCases();
  await capacityCases();

  console.log(failures === 0 ? '\nAll smoke checks passed.' : '\n' + failures + ' smoke check(s) failed.');
  process.exit(failures === 0 ? 0 : 1);
})();
