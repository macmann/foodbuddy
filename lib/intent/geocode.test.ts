import assert from "node:assert/strict";
import test from "node:test";

import { buildGeocodeQuery } from "./geocode";

test("geocode query adds Myanmar bias for Yangon", () => {
  const query = buildGeocodeQuery("Yangon", { locale: "my-MM" });
  assert.equal(query, "Yangon, Myanmar");
});

test("geocode query adds Myanmar bias for Thanlyin", () => {
  const query = buildGeocodeQuery("Thanlyin", { locale: "my-MM" });
  assert.equal(query, "Thanlyin, Yangon, Myanmar");
});

test("geocode query avoids Myanmar bias for Berlin", () => {
  const query = buildGeocodeQuery("Berlin", { locale: "my-MM" });
  assert.equal(query, "Berlin");
});
