import { newScene, newObject, newCamera } from "../../src/domain/model.ts";
export function cafe() {
  const p = newScene("咖啡馆 迟到的约定");
  p.environment.white_model = false;
  p.environment.grid = false;
  p.timeline = { fps: 25, duration_frames: 275 };
  for (const [id, name, preset, position, yaw, marker] of [
    ["woman", "女主", "person-standing", [-0.9, 0, 0], 180, "blue"],
    ["clerk", "店员", "person-standing", [0, 0, -1.8], 0, "red"],
    ["man", "男主", "person-standing", [0.9, 0, 0], -70, "green"],
    ["counter", "吧台", "box", [0, 0, -1], 0, null],
    ["wall", "后墙", "wall-5m", [0, 0, -3], 0, null],
    ["table", "圆桌", "cylinder", [-3, 0, 2], 0, null],
  ] as const) {
    const o = newObject(preset, id, name);
    o.transform.position = [...position];
    o.transform.rotation[1] = yaw;
    if (marker) o.marker = marker;
    if (id === "counter") o.transform.scale = [4.2, 1.1, 0.65];
    p.objects.push(o);
  }
  p.cameras = [
    {
      ...newCamera("wide", "全景"),
      position: [0, 1.65, 7],
      target: [0, 1.3, -0.6],
      focal_length_mm: 28,
    },
    {
      ...newCamera("over", "过女主拍男主"),
      position: [-2, 1.65, 3],
      target: [0.9, 1.3, 0],
      focal_length_mm: 40,
    },
    {
      ...newCamera("reverse", "男主反打"),
      position: [2, 1.65, 3],
      target: [-0.9, 1.3, 0],
      focal_length_mm: 40,
    },
  ];
  p.shots = [
    { id: "s1", label: "S1", camera_id: "wide", start: 0, end: 75 },
    {
      id: "s2",
      label: "S2",
      camera_id: "over",
      start: 75,
      end: 150,
      dialogue: {
        speaker_id: "man",
        text: "你今天怎么来这么早？",
        source_index: null,
      },
    },
    {
      id: "s3",
      label: "S3",
      camera_id: "reverse",
      start: 150,
      end: 200,
      dialogue: {
        speaker_id: "woman",
        text: "因为我想先帮你点好那杯不加糖的美式。",
        source_index: null,
      },
    },
    {
      id: "s4",
      label: "S4",
      camera_id: "wide",
      start: 200,
      end: 275,
      dialogue: {
        speaker_id: "clerk",
        text: "两位，咖啡好了。",
        source_index: null,
      },
    },
  ];
  p.dialogue_axis = { from_id: "woman", to_id: "man" };
  p.speech_rate = 4;
  return p;
}
