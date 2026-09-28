import { describe, expect, it } from "vitest";
import { ApiError } from "./api.js";
import type { CloudScripts, Project } from "./api-types.js";
import {
  counterLine,
  draftOf,
  formatCount,
  inputOf,
  MAX_SCRIPT_BYTES,
  precedenceLine,
  saveRefusal,
  scriptBytes,
  scriptsChanged,
  showsCloudScripts,
  sizeProblem,
  storedScript,
} from "./cloudScripts.js";

const none: CloudScripts = {
  install: null,
  resume: null,
  runRepositoryScripts: true,
  updatedAt: null,
};

describe("which script runs", () => {
  it("says the page replaces the file when the field has text, whatever the switch says", () => {
    expect(precedenceLine("install", "npm ci", true)).toBe(
      "Replaces .exeora/cloud_install.sh from the repository.",
    );
    expect(precedenceLine("install", "npm ci", false)).toBe(
      "Replaces .exeora/cloud_install.sh from the repository.",
    );
    expect(precedenceLine("resume", "docker compose up -d", true)).toBe(
      "Replaces .exeora/cloud_resume.sh from the repository.",
    );
    expect(precedenceLine("resume", "docker compose up -d", false)).toBe(
      "Replaces .exeora/cloud_resume.sh from the repository.",
    );
  });

  it("leaves an empty field to the file in the repository while the switch is on", () => {
    expect(precedenceLine("install", "", true)).toBe(
      "Empty: .exeora/cloud_install.sh from the repository runs when it exists.",
    );
    expect(precedenceLine("resume", "", true)).toBe(
      "Empty: .exeora/cloud_resume.sh from the repository runs when it exists.",
    );
  });

  it("says nothing runs for an empty field with the switch off", () => {
    expect(precedenceLine("install", "", false)).toBe("Empty: nothing runs.");
    expect(precedenceLine("resume", "", false)).toBe("Empty: nothing runs.");
  });

  it("reads a field of spaces and new lines as an empty one", () => {
    expect(precedenceLine("install", "  \n\t\n", true)).toBe(
      "Empty: .exeora/cloud_install.sh from the repository runs when it exists.",
    );
    expect(precedenceLine("install", "  \n", false)).toBe("Empty: nothing runs.");
    expect(storedScript("  \n")).toBeNull();
    expect(storedScript(" npm ci\n")).toBe(" npm ci\n");
  });
});

describe("the size of a script", () => {
  it("counts bytes of UTF-8 and not characters", () => {
    expect(scriptBytes("")).toBe(0);
    expect(scriptBytes("echo")).toBe(4);
    expect(scriptBytes("é")).toBe(2);
    expect(scriptBytes("日本")).toBe(6);
    // One character on screen, two units in a string, four bytes on the wire.
    expect("🚀".length).toBe(2);
    expect(scriptBytes("🚀")).toBe(4);
    expect(scriptBytes("echo é 🚀\n")).toBe(13);
  });

  it("writes a count with its thousands apart", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(999)).toBe("999");
    expect(formatCount(16_384)).toBe("16 384");
    expect(formatCount(1_234_567)).toBe("1 234 567");
  });

  it("shows the counter only near the limit", () => {
    expect(counterLine("echo hello")).toBeNull();
    expect(counterLine("a".repeat(12_287))).toBeNull();
    expect(counterLine("a".repeat(12_288))).toBe("12 288 of 16 384 bytes");
    expect(counterLine("a".repeat(MAX_SCRIPT_BYTES))).toBe("16 384 of 16 384 bytes");
  });

  it("takes a script of exactly the limit and refuses one byte more", () => {
    expect(sizeProblem("install", "a".repeat(MAX_SCRIPT_BYTES))).toBeNull();
    expect(sizeProblem("install", "a".repeat(MAX_SCRIPT_BYTES + 1))).toBe(
      "The install script is 16 385 bytes, and the limit is 16 384. Shorten it to save.",
    );
  });

  it("refuses a script that fits in characters and not in bytes", () => {
    const script = "é".repeat(8_193);
    expect(script.length).toBeLessThan(MAX_SCRIPT_BYTES);
    expect(counterLine(script)).toBe("16 386 of 16 384 bytes");
    expect(sizeProblem("resume", script)).toBe(
      "The resume script is 16 386 bytes, and the limit is 16 384. Shorten it to save.",
    );
  });
});

describe("what is saved", () => {
  it("opens an empty field for a script that was never written", () => {
    expect(draftOf(none)).toEqual({ install: "", resume: "", runRepositoryScripts: true });
    expect(draftOf({ ...none, install: "npm ci\n", runRepositoryScripts: false })).toEqual({
      install: "npm ci\n",
      resume: "",
      runRepositoryScripts: false,
    });
  });

  it("sends nothing for an empty field, and the text as written for the rest", () => {
    expect(inputOf({ install: "npm ci", resume: "   ", runRepositoryScripts: false })).toEqual({
      install: "npm ci",
      resume: null,
      runRepositoryScripts: false,
    });
  });

  it("knows whether anything moved", () => {
    const draft = draftOf(none);
    expect(scriptsChanged(draft, none)).toBe(false);
    // Spaces in an empty field are still an empty field.
    expect(scriptsChanged({ ...draft, install: "  \n" }, none)).toBe(false);
    expect(scriptsChanged({ ...draft, install: "npm ci" }, none)).toBe(true);
    expect(scriptsChanged({ ...draft, runRepositoryScripts: false }, none)).toBe(true);
    expect(scriptsChanged({ ...draft, resume: "" }, { ...none, resume: "make up\n" })).toBe(true);
  });
});

describe("where the card is shown", () => {
  const project = (patch: Partial<Project>) =>
    ({
      repoUrl: "https://github.com/example/widgets.git",
      cloud: null,
      locations: [],
      ...patch,
    }) as Pick<Project, "repoUrl" | "cloud" | "locations">;
  const cloud = { repoUrl: "https://github.com/example/widgets.git" } as Project["cloud"];
  const onCloud = [{ kind: "cloud" }] as Project["locations"];

  it("is there for an account that has Exeora Cloud", () => {
    expect(showsCloudScripts(project({}), { cloudEnabled: true })).toBe(true);
  });

  it("is there for a project on Exeora Cloud, even with Cloud switched off for the account", () => {
    expect(showsCloudScripts(project({ cloud }), { cloudEnabled: false })).toBe(true);
    expect(showsCloudScripts(project({ locations: onCloud }), undefined)).toBe(true);
  });

  it("is not there without either", () => {
    expect(showsCloudScripts(project({}), { cloudEnabled: false })).toBe(false);
    expect(showsCloudScripts(project({}), undefined)).toBe(false);
  });

  it("is never there for a directory with no repository", () => {
    expect(showsCloudScripts(project({ repoUrl: null }), { cloudEnabled: true })).toBe(false);
  });
});

describe("a refusal to save", () => {
  it("names the script that is too large, and the limit the gateway gave", () => {
    expect(
      saveRefusal(new ApiError(422, { error: "script_too_large", hook: "resume", max: 16_384 })),
    ).toEqual({
      hook: "resume",
      message: "The resume script is larger than 16 384 bytes. Shorten it, then save again.",
    });
  });

  it("repeats what the gateway said of a script it could not read", () => {
    expect(
      saveRefusal(
        new ApiError(422, {
          error: "invalid_script",
          hook: "install",
          message: "The script holds a character no shell can read. Paste it again as plain text.",
        }),
      ),
    ).toEqual({
      hook: "install",
      message:
        "The install script was not saved. The script holds a character no shell can read. Paste it again as plain text.",
    });
  });

  it("says a project that is gone is gone", () => {
    expect(saveRefusal(new ApiError(404, { error: "not_found" }))).toEqual({
      hook: null,
      message: "This project no longer exists, so the scripts were not saved. Reload the page.",
    });
  });

  it("says the cause it was given, and what to do when it was given none", () => {
    expect(saveRefusal(new ApiError(500, null)).message).toBe(
      "The scripts were not saved. The gateway could not complete the request.",
    );
    expect(saveRefusal("nothing").message).toBe(
      "The scripts were not saved. Try again in a moment.",
    );
  });
});
