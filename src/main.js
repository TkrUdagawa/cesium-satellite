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
  CallbackProperty,
  ArcType,
  Ray,
  IntersectionTests,
  Ellipsoid,
} from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";

import { propagate, gstime, eciToGeodetic, twoline2satrec } from "satellite.js"; // {propagate,gstime, eciToGeodetic} from 'satellite.js';
import "./style.css";

/*globals process */
Ion.defaultAccessToken = process.env.VITE_ION_TOKEN;

const yam6_TLE = `1 59126U 24043AE  25029.29948926  .00017226  00000+0  68604-3 0  9997
     2 59126  97.4927 157.8990 0009969 213.8000 146.2603 15.25258982 50193`;

const himawari_TLE = `1 41836U 16064A   25029.56736201 -.00000267  00000+0  00000+0 0  9991
   2 41836   0.0188 199.9810 0001239 148.2969 125.8054  1.00267818 30160`;
// Initialize the satellite record with this TLE

// QPS-SAR-8 (AMATERU-IV)
const qps8_TLE = `1 60542U 24149CC  25030.22755928  .00011154  00000+0  98646-3 0  9994
            2 60542  97.7297 109.3402 0002930 340.0519  20.0588 14.96472627 24844`;
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

const qps8_info = {
  tle: qps8_TLE,
  name: "QPS-SAR-8 (AMATERU-IV) ",
  point: {
    pixelSize: 10,
    color: Color.RED,
  },
};
const TLEs = [himawari_info, yam6_info, qps8_info];

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

/**
 * @param {Cesium.Cartesian3} pointA - 衛星Aの位置(ECEF座標)
 * @param {Cesium.Cartesian3} pointB - 衛星Bの位置(ECEF座標)
 * @returns {boolean} - 地球(WGS84)と交差していればtrue
 */
function checkLineSegmentIntersectsEarth(pointA, pointB) {
  // 1) A->B のベクトル
  const direction = Cartesian3.subtract(pointB, pointA, new Cartesian3());
  const segmentLength = Cartesian3.magnitude(direction);

  // 2) レイ (Ray) を作成: origin=A, direction=正規化ベクトル
  const normalizedDir = Cartesian3.normalize(direction, new Cartesian3());
  const ray = new Ray(pointA, normalizedDir);

  // 3) 楕円体との交差判定
  //    成功すると { start: Number, stop: Number } が返る (Rayと楕円体との交差パラメータ)
  //    交差しない場合は undefined が返る
  const intersection = IntersectionTests.rayEllipsoid(ray, Ellipsoid.WGS84);
  if (!intersection) {
    // 交差しない => 地球を貫いていない
    return false;
  }

  // 4) intersection.start, intersection.stop はRay上のパラメータt(射影距離)
  //    これが線分の範囲 [0, segmentLength] 内にあれば交差
  const nearT = intersection.start;
  const farT = intersection.stop;

  // nearT or farT のどちらかが 0 <= t <= segmentLength なら、線分が地球と交わる
  const intersects =
    (nearT >= 0 && nearT <= segmentLength) ||
    (farT >= 0 && farT <= segmentLength);

  return intersects;
}

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

const entities = TLEs.map((satInfo) => {
  const positionProperty = createPositionOverTimeSample(
    start,
    timeStepInSeconds,
    steps,
    satInfo.tle,
  );
  return viewer.entities.add({
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

const linePositions = new CallbackProperty((time, result) => {
  const posA = entities[0].position.getValue(time);
  const posB = entities[1].position.getValue(time);
  // もし片方がまだ無効 (未計算や範囲外など) なら線を引かない
  if (!posA || !posB) {
    return []; // または null / undefined
  }
  if (checkLineSegmentIntersectsEarth(posA, posB)) {
    return [];
  }
  // result が存在すれば再利用する (パフォーマンス最適化)
  // 2点だけの配列を返すことで、衛星間を結ぶ直線が描画される
  if (!result) {
    result = [];
  }
  result[0] = posA;
  result[1] = posB;

  return result;
}, false);

const linePositions2 = new CallbackProperty((time, result) => {
  const posA = entities[0].position.getValue(time);
  const posB = entities[2].position.getValue(time);
  // もし片方がまだ無効 (未計算や範囲外など) なら線を引かない
  if (!posA || !posB) {
    return []; // または null / undefined
  }
  if (checkLineSegmentIntersectsEarth(posA, posB)) {
    return [];
  }
  // result が存在すれば再利用する (パフォーマンス最適化)
  // 2点だけの配列を返すことで、衛星間を結ぶ直線が描画される
  if (!result) {
    result = [];
  }
  result[0] = posA;
  result[1] = posB;

  return result;
}, false);

viewer.entities.add({
  name: "Line between Satellite A and B",
  polyline: {
    positions: linePositions,
    width: 2,
    material: Color.YELLOW,
    arcType: ArcType.NONE,
  },
});

viewer.entities.add({
  name: "Line between Satellite A and B",
  polyline: {
    positions: linePositions2,
    width: 2,
    material: Color.YELLOW,
    arcType: ArcType.NONE,
  },
});
