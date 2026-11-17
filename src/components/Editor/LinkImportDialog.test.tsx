import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import LinkImportDialog from "./LinkImportDialog";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class<T> {
    constructor(public onmessage: (value: T) => void) {}
  },
}));

it("inspects a URL and imports the chosen quality with audio disabled", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finishDownload!: (path: string) => void;
  const download = new Promise<string>((resolve) => { finishDownload = resolve; });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "editor_link_ready") return true;
    if (command === "inspect_editor_link") {
      return {
        title: "Test video",
        formats: [
          { id: "high", width: 3840, height: 2160, codec: "av01", embeddedAudio: false },
          { id: "standard-av1", width: 1920, height: 1080, codec: "av01", embeddedAudio: true },
          { id: "standard", width: 1920, height: 1080, codec: "avc1", embeddedAudio: true },
        ],
        separateAudio: true,
      };
    }
    if (command === "download_editor_link") {
      const { progress } = args as { progress: { onmessage: (event: object) => void } };
      progress.onmessage({ phase: "Converting video for the editor", percent: 60 });
      return download;
    }
    throw new Error(`Unexpected command ${command}`);
  });
  const onImported = vi.fn(async () => {});
  const onClose = vi.fn();
  const onBusy = vi.fn();
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<LinkImportDialog onClose={onClose} onBusy={onBusy} onImported={onImported} />);
  });
  const url = "https://example.com/video";
  await act(async () => view.root.findByProps({ id: "link-import-url" }).props.onChange({ target: { value: url } }));
  await act(async () => view.root.findByType("form").props.onSubmit({ preventDefault: () => {} }));
  const quality = view.root.findByType("select");
  expect(quality.props.value).toBe("standard");
  await act(async () => {
    quality.props.onChange({ target: { value: "high" } });
    view.root.findByProps({ type: "checkbox" }).props.onChange({ target: { checked: false } });
  });
  await act(async () => view.root.findByType("footer").findByType("button").props.onClick());
  expect(view.root.findByType("progress").props.value).toBe(60);
  expect(onImported).not.toHaveBeenCalled();
  await act(async () => finishDownload("C:\\Snap\\test.mp4"));
  expect(invoke).toHaveBeenCalledWith("download_editor_link", {
    request: { url, title: "Test video", formatId: "high", embeddedAudio: false, withAudio: false },
    progress: expect.any(Object),
  });
  expect(onImported).toHaveBeenCalledWith("C:\\Snap\\test.mp4");
  expect(onClose).toHaveBeenCalledOnce();
  await act(async () => view.unmount());
  vi.unstubAllGlobals();
});

it("installs the missing downloader in the editor and keeps the pasted URL", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finishInstall!: () => void;
  const installation = new Promise<void>((resolve) => { finishInstall = resolve; });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "editor_link_ready") return false;
    if (command === "install_editor_link") {
      const { progress } = args as { progress: { onmessage: (event: object) => void } };
      progress.onmessage({ phase: "Downloading video downloader", percent: 25 });
      return installation;
    }
    throw new Error(`Unexpected command ${command}`);
  });
  const onBusy = vi.fn();
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<LinkImportDialog onClose={vi.fn()} onBusy={onBusy} onImported={vi.fn()} />);
  });
  const url = "https://example.com/watch";
  const field = view.root.findByProps({ id: "link-import-url" });
  await act(async () => field.props.onChange({ target: { value: url } }));
  const check = view.root.findByProps({ type: "submit" });
  expect(check.props.disabled).toBe(true);
  const setup = view.root.findAllByType("button").find((button) =>
    button.children.some((child) => typeof child === "string" && child.includes("Install downloader")),
  );
  expect(setup).toBeDefined();
  await act(async () => setup!.props.onClick());
  expect(view.root.findByType("progress").props.value).toBe(25);
  expect(onBusy).toHaveBeenLastCalledWith(true);
  await act(async () => finishInstall());
  expect(check.props.disabled).toBe(false);
  expect(field.props.value).toBe(url);
  expect(onBusy).toHaveBeenLastCalledWith(false);
  await act(async () => view.unmount());
  vi.unstubAllGlobals();
});
