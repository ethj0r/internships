import { describe, expect, it } from "vitest";
import { classifyRegion, inSearchScope } from "../shared/regions";
import type { Workplace } from "../shared/types";
import { himalayasLocation } from "../worker/discovery/sources/himalayas";
import { srLocation } from "../worker/discovery/sources/smartrecruiters";
import { workableLocation } from "../worker/discovery/sources/workable";
import { detectWorkplace } from "../worker/lib/text";

describe("classifyRegion", () => {
  it.each<[string, Workplace, string]>([
    ["Jakarta, Indonesia", "onsite", "indonesia"],
    ["Bandung, West Java", "hybrid", "indonesia"],
    ["Remote, 53 countries including Indonesia", "remote", "indonesia"],
    ["Remote - APAC", "remote", "remote_open"],
    ["Remote, Worldwide", "remote", "remote_open"],
    ["Remote, Singapore", "remote", "remote_asia"],
    ["Remote", "remote", "remote_unknown"],
    ["Remote - US: All locations", "remote", "other"],
    ["Singapore", "onsite", "asia"],
    ["Minato City, Japan", "hybrid", "asia"],
    ["San Francisco, CA", "onsite", "other"],
    ["Austin, TX", "onsite", "other"],
    ["Bengaluru", "onsite", "other"],
    ["", "unknown", "unknown"],
  ])("%s (%s) → %s", (location, workplace, expected) => {
    expect(classifyRegion({ location, workplace })).toBe(expected);
  });

  it("reads remote restrictions from the description", () => {
    expect(classifyRegion({ location: "Remote", workplace: "remote", description: "Candidates must be located in the United States." })).toBe("other");
    expect(classifyRegion({ location: "Remote", workplace: "remote", description: "Work from anywhere in the world." })).toBe("remote_open");
  });
});

describe("inSearchScope", () => {
  it("keeps Indonesia and remote roles, and on-site Asia only when asked", () => {
    expect(inSearchScope("indonesia", "indonesia_remote")).toBe(true);
    expect(inSearchScope("remote_open", "indonesia_remote")).toBe(true);
    expect(inSearchScope("asia", "indonesia_remote")).toBe(false);
    expect(inSearchScope("asia", "asia")).toBe(true);
    expect(inSearchScope("other", "asia")).toBe(false);
    expect(inSearchScope("other", "anywhere")).toBe(true);
  });
});

describe("source locations", () => {
  it("treats home-based roles as remote", () => {
    expect(detectWorkplace("Home based - Asia Pacific", "Graduate Software Engineer", "")).toBe("remote");
  });
  it("formats SmartRecruiters locations", () => {
    expect(srLocation({ city: "Singapore", country: "sg" })).toBe("Singapore");
    expect(srLocation({ city: "Jakarta", region: "", country: "id" })).toBe("Jakarta, Indonesia");
    expect(srLocation({ country: "ph", remote: true })).toBe("Remote, Philippines");
  });
  it("summarizes Himalayas country restrictions", () => {
    expect(himalayasLocation([], "Indonesia")).toBe("Remote, Worldwide");
    expect(himalayasLocation(["Indonesia"], "Indonesia")).toBe("Remote, Indonesia");
    expect(himalayasLocation(["Australia", "Indonesia", "Japan", "Singapore"], "Indonesia")).toBe("Remote, 4 countries including Indonesia");
  });
  it("formats Workable locations", () => {
    expect(workableLocation({ title: "", shortcode: "", url: "", locations: [{ city: "Minato City", country: "Japan" }] })).toBe("Minato City, Japan");
    expect(workableLocation({ title: "", shortcode: "", url: "", telecommuting: true, country: "Japan" })).toBe("Remote, Japan");
  });
});
