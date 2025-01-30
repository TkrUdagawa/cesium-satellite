import {
  Cartesian3,
  Terrain,
  Viewer,
  createOsmBuildingsAsync,
  Ion,
  Color,
  SampledPositionProperty,
  JulianDate,
  ClockRange,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import { propagate, gstime, eciToGeodetic, twoline2satrec } from "satellite.js"; // {propagate,gstime, eciToGeodetic} from 'satellite.js';
import "./style.css";

Ion.defaultAccessToken = "your token";

const yam6_TLE = `1 59126U 24043AE  25029.29948926  .00017226  00000+0  68604-3 0  9997
     2 59126  97.4927 157.8990 0009969 213.8000 146.2603 15.25258982 50193`;

const himawari_TLE = `1 41836U 16064A   25029.56736201 -.00000267  00000+0  00000+0 0  9991
   2 41836   0.0188 199.9810 0001239 148.2969 125.8054  1.00267818 30160`;
// Initialize the satellite record with this TLE

const yam6_info = {
  tle: yam6_TLE,
  name: "yam-6",
  point: {
    pixelSize: 10,
    color: Color.RED,
  },
};

const himawari_info = {
  tle: himawari_TLE,
  name: "himawari 9",
  point: {
    pixelSize: 10,
    color: Color.RED,
  },
};
const TLEs = [yam6_info, himawari_info];

// Initialize the Cesium Viewer in the HTML element with the `cesiumContainer` ID.
const viewer = new Viewer("cesiumContainer", {
  terrain: Terrain.fromWorldTerrain(),
});

// Add Cesium OSM Buildings, a global 3D buildings layer.
createOsmBuildingsAsync().then((buildingTileset) => {
  viewer.scene.primitives.add(buildingTileset);
});

const steps = 10000;
const timeStepInSeconds = 30;
const totalSeconds = timeStepInSeconds * steps;
const start = JulianDate.fromIso8601("2020-03-09T23:10:00Z");
const stop = JulianDate.addSeconds(start, totalSeconds, new JulianDate());

viewer.clock.startTime = start.clone();
viewer.clock.stopTime = stop.clone();
viewer.clock.currentTime = start.clone();
viewer.timeline.zoomTo(start, stop);
viewer.clock.multiplier = 40;
viewer.clock.clockRange = ClockRange.LOOP_STOP;

const getPosition = (tle, dateJS) => {
  const satrec = twoline2satrec(
    tle.split("\n")[0].trim(),
    tle.split("\n")[1].trim(),
  );
  const positionAndVelocity = propagate(satrec, dateJS);
  const gmst = gstime(dateJS);
  const position = eciToGeodetic(positionAndVelocity.position, gmst);
  return position;
};

const createPositionOverTimeSample = (
  startTime,
  timeStepInSeconds,
  steps,
  tle,
) => {
  const totalSeconds = timeStepInSeconds * steps;
  const positionProperty = new SampledPositionProperty();
  for (let i = 0; i < totalSeconds; i += timeStepInSeconds) {
    const time = JulianDate.addSeconds(startTime, i, new JulianDate());
    const jsDate = JulianDate.toDate(time);
    const p = getPosition(tle, jsDate);
    const position = Cartesian3.fromRadians(
      p.longitude,
      p.latitude,
      p.height * 1000,
    );
    positionProperty.addSample(time, position);
  }
  return positionProperty;
};

TLEs.map((satInfo) => {
  const positionProperty = createPositionOverTimeSample(
    start,
    timeStepInSeconds,
    steps,
    satInfo.tle,
  );
  viewer.entities.add({
    name: satInfo.name,
    position: positionProperty,
    point: satInfo.point,
    path: {
      leadTime: 3600, // 未来方向の描画秒数 (0にすると未来の線は描かない)
      trailTime: 3600, // 過去方向の描画秒数 (例: 1時間分の軌跡)
      width: 2,
      material: Color.RED,
    },
  });
});
