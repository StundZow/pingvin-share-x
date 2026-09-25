// StundTransfer: deposit page. The uploader says who they are and which video
// it is for, drops files or folders, and gets "Reçu, merci !". No account,
// no share link, no download page.
import {
  Alert,
  Button,
  Center,
  CloseButton,
  Group,
  Loader,
  Paper,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useModals } from "@mantine/modals";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  TbAlertTriangle,
  TbCircleCheck,
  TbInfoCircle,
  TbPlugConnectedX,
  TbRefresh,
  TbX,
} from "react-icons/tb";
import { FormattedMessage, useIntl } from "react-intl";
import Meta from "../components/Meta";
import useConfirmLeave from "../hooks/confirm-leave.hook";
import useTranslate from "../hooks/useTranslate.hook";
import toast from "../utils/toast.util";
import DepositDropzone from "./DepositDropzone";
import {
  SelectedFile,
  fileKey,
  formatDuration,
  formatSize,
  resumeMemory,
  selectFiles,
} from "./depositFiles";
import stundTransferService, {
  DepositFileState,
  DepositSession,
  DepositState,
  LinkInfo,
} from "./stundtransfer.service";
import {
  DepositUploader,
  UploadItem,
  UploadProgress,
  chunkLength,
  toFatalError,
} from "./uploader";

const BATCH_SIZE = 250;
const FILE_PREVIEW_COUNT = 8;
const DONE_PREVIEW_COUNT = 20;

type Phase =
  | { name: "checking" }
  | { name: "form" }
  | { name: "resume"; state: DepositState; session: DepositSession }
  | { name: "preparing" }
  | { name: "uploading" }
  | { name: "finishing" }
  | { name: "done"; paths: string[]; totalSize: number }
  | { name: "error"; code: string; values?: Record<string, string> };

const total = (values: number[]) => values.reduce((a, b) => a + b, 0);

/** Retries calls failing because of the network; errors that will not go away are thrown. */
async function withNetworkRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (e) {
      if (toFatalError(e) || attempt >= 30) throw e;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(30000, 1000 * 2 ** Math.min(attempt, 5))),
      );
    }
  }
}

// token: deposit link; undefined for the public deposit of the home page
const DepositPage = ({ token, info }: { token?: string; info: LinkInfo }) => {
  const memoryKey = token ?? "public";
  const t = useTranslate();
  const intl = useIntl();
  const humanSize = (bytes: number) => formatSize(bytes, intl.locale);
  const [phase, setPhase] = useState<Phase>({ name: "checking" });
  const [uploaderName, setUploaderName] = useState("");
  const [videoName, setVideoName] = useState("");
  const [selected, setSelected] = useState<SelectedFile[]>([]);
  const [ignored, setIgnored] = useState(0);
  const [progress, setProgress] = useState<UploadProgress>();
  const modals = useModals();
  const uploader = useRef<DepositUploader>();
  // Deposit being uploaded, and whether the uploader cancelled it
  const currentSession = useRef<DepositSession>();
  const cancelled = useRef(false);
  const wakeLock = useRef<{ release: () => Promise<void> }>();

  const busy = ["preparing", "uploading", "finishing"].includes(phase.name);
  useConfirmLeave({
    message: t("stundtransfer.upload.confirm-leave"),
    enabled: busy,
  });

  const maxSize = info.maxSize ?? 0;
  const selectedSize = useMemo(() => total(selected.map((f) => f.size)), [selected]);
  const selectedByKey = useMemo(
    () => new Map(selected.map((f) => [fileKey(f.path, f.size), f])),
    [selected],
  );
  const fieldsFilled = uploaderName.trim() !== "" && videoName.trim() !== "";

  useEffect(() => {
    checkInterruptedUpload();
    return () => uploader.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the screen awake while uploading (the lock is lost when the tab is hidden)
  useEffect(() => {
    const acquire = async () => {
      try {
        wakeLock.current = await (navigator as any).wakeLock?.request("screen");
      } catch {
        // Not supported or refused: the upload works anyway
      }
    };
    const release = () => {
      wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = undefined;
    };
    if (!busy) return release();
    acquire();
    const onVisible = () => document.visibilityState === "visible" && acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [busy]);

  // An upload interrupted by a reload or a closed tab can be resumed
  const checkInterruptedUpload = async () => {
    setPhase({ name: "checking" });
    const saved = resumeMemory.load(memoryKey);
    if (!saved) return setPhase({ name: "form" });
    try {
      const state = await stundTransferService.getDeposit(saved);
      if (state.status !== "UPLOADING") {
        resumeMemory.clear(memoryKey);
        return setPhase({ name: "form" });
      }
      setUploaderName(state.uploaderName);
      setVideoName(state.videoName);
      setPhase({
        name: "resume",
        state,
        session: {
          depositId: state.depositId,
          secret: saved.secret,
          chunkSize: state.chunkSize,
          parallelUploads: state.parallelUploads,
        },
      });
    } catch (e) {
      if (toFatalError(e)) resumeMemory.clear(memoryKey);
      setPhase({ name: "form" });
    }
  };

  const addFiles = (files: File[]) => {
    const { kept, ignored: skipped } = selectFiles(files);
    const known = new Set(selected.map((f) => f.path));
    const fresh: SelectedFile[] = [];
    const duplicates: string[] = [];
    for (const file of kept) {
      if (known.has(file.path)) duplicates.push(file.path);
      else {
        known.add(file.path);
        fresh.push(file);
      }
    }
    if (duplicates.length > 0)
      toast.error(
        t("stundtransfer.files.duplicate", {
          name:
            duplicates.length > 1
              ? `${duplicates[0]} (+${duplicates.length - 1})`
              : duplicates[0],
        }),
      );
    if (
      phase.name === "form" &&
      maxSize > 0 &&
      selectedSize + total(fresh.map((f) => f.size)) > maxSize
    ) {
      toast.error(t("stundtransfer.files.too-big", { maxSize: humanSize(maxSize) }));
      return;
    }
    setIgnored((count) => count + skipped);
    setSelected((current) => [...current, ...fresh]);
  };

  // Server files still missing chunks, matched with the files picked in the browser
  const toUploadItems = (files: DepositFileState[]): UploadItem[] =>
    files
      .filter((f) => f.status === "UPLOADING")
      .map((f) => ({
        id: f.id,
        file: selectedByKey.get(fileKey(f.path, f.size))!.file,
        path: f.path,
        size: f.size,
        totalChunks: f.totalChunks,
        received: new Set(f.receivedChunks ?? []),
      }));

  const fail = (e: unknown) => {
    uploader.current?.stop();
    if (cancelled.current) return;
    const fatal = toFatalError(e);
    if (!fatal) console.error(e);
    setPhase({ name: "error", code: fatal?.code ?? "unknown", values: fatal?.values });
  };

  const upload = async (
    session: DepositSession,
    items: UploadItem[],
    paths: string[],
    totalSize: number,
  ) => {
    currentSession.current = session;
    cancelled.current = false;
    setPhase({ name: "uploading" });
    for (let round = 0; ; round++) {
      const run = new DepositUploader(session, items, setProgress);
      uploader.current = run;
      await run.run();
      if (cancelled.current) return;
      setPhase({ name: "finishing" });
      try {
        await withNetworkRetry(() => stundTransferService.complete(session));
        break;
      } catch (e) {
        if (toFatalError(e)?.code !== "stund_incomplete" || round >= 2) throw e;
        // The server is missing some chunks: send them again
        const state = await withNetworkRetry(() => stundTransferService.getDeposit(session));
        items = toUploadItems(state.files);
        setPhase({ name: "uploading" });
      }
    }
    resumeMemory.clear(memoryKey);
    setPhase({ name: "done", paths, totalSize });
  };

  const send = async () => {
    cancelled.current = false;
    setProgress(undefined);
    setPhase({ name: "preparing" });
    try {
      const session = await withNetworkRetry(() =>
        stundTransferService.createDeposit({
          token,
          uploaderName: uploaderName.trim(),
          videoName: videoName.trim(),
          fileCount: selected.length,
          totalSize: selectedSize,
        }),
      );
      resumeMemory.save(memoryKey, {
        depositId: session.depositId,
        secret: session.secret,
        savedAt: Date.now(),
      });
      const registered: DepositFileState[] = [];
      for (let i = 0; i < selected.length; i += BATCH_SIZE) {
        const batch = selected.slice(i, i + BATCH_SIZE).map((f) => ({
          path: f.path,
          size: f.size,
          lastModified: f.lastModified,
        }));
        registered.push(
          ...(await withNetworkRetry(() => stundTransferService.addFiles(session, batch))),
        );
      }
      await upload(
        session,
        toUploadItems(registered),
        selected.map((f) => f.path),
        selectedSize,
      );
    } catch (e) {
      fail(e);
    }
  };

  const resume = async () => {
    if (phase.name !== "resume") return;
    const { state, session } = phase;
    cancelled.current = false;
    setProgress(undefined);
    try {
      await upload(
        session,
        toUploadItems(state.files),
        state.files.map((f) => f.path),
        state.totalSize,
      );
    } catch (e) {
      fail(e);
    }
  };

  const cancelUpload = () =>
    modals.openConfirmModal({
      title: t("stundtransfer.upload.cancel.confirm.title"),
      children: (
        <Text size="sm">{t("stundtransfer.upload.cancel.confirm.description")}</Text>
      ),
      labels: {
        confirm: t("stundtransfer.upload.cancel.confirm.yes"),
        cancel: t("stundtransfer.upload.cancel.confirm.no"),
      },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        cancelled.current = true;
        uploader.current?.stop();
        const session = currentSession.current;
        if (session)
          await stundTransferService.cancelDeposit(session).catch(() => undefined);
        resumeMemory.clear(memoryKey);
        setProgress(undefined);
        setPhase({ name: "form" });
        toast.success(t("stundtransfer.upload.cancelled"));
      },
    });

  const startOver = () => {
    // Giving up an interrupted upload: delete what was already sent
    if (phase.name === "resume")
      stundTransferService.cancelDeposit(phase.session).catch(() => undefined);
    resumeMemory.clear(memoryKey);
    setSelected([]);
    setIgnored(0);
    setProgress(undefined);
    setPhase({ name: "form" });
  };

  const fileSummary = selected.length > 0 && phase.name === "form" && (
    <Paper withBorder radius="md" p="md">
      <Group position="apart" mb="xs">
        <Text weight={600}>
          {t("stundtransfer.files.summary", {
            count: selected.length,
            size: humanSize(selectedSize),
          })}
        </Text>
        <Button
          variant="subtle"
          color="gray"
          size="xs"
          onClick={() => {
            setSelected([]);
            setIgnored(0);
          }}
        >
          <FormattedMessage id="stundtransfer.files.clear" />
        </Button>
      </Group>
      <Stack spacing={4}>
        {selected.slice(0, FILE_PREVIEW_COUNT).map((f) => (
          <Group key={f.path} position="apart" noWrap spacing="xs">
            <Text size="sm" truncate sx={{ minWidth: 0 }}>
              {f.path}
            </Text>
            <Group spacing="xs" noWrap>
              <Text size="xs" color="dimmed">
                {humanSize(f.size)}
              </Text>
              <CloseButton
                size="sm"
                aria-label={f.path}
                onClick={() =>
                  setSelected((current) => current.filter((c) => c.path !== f.path))
                }
              />
            </Group>
          </Group>
        ))}
        {selected.length > FILE_PREVIEW_COUNT && (
          <Text size="sm" color="dimmed">
            {t("stundtransfer.files.more", {
              count: selected.length - FILE_PREVIEW_COUNT,
            })}
          </Text>
        )}
      </Stack>
      {ignored > 0 && (
        <Text size="xs" color="dimmed" mt="xs">
          {t("stundtransfer.files.ignored", { count: ignored })}
        </Text>
      )}
    </Paper>
  );

  const content = (() => {
    switch (phase.name) {
      case "checking":
        return (
          <Center py="xl">
            <Loader />
          </Center>
        );

      case "form":
        return (
          <Stack spacing="lg">
            <div>
              <Title order={2}>
                <FormattedMessage id="stundtransfer.form.title" />
              </Title>
              <Text color="dimmed" size="sm">
                <FormattedMessage id="stundtransfer.form.subtitle" />
              </Text>
            </div>
            <SimpleGrid cols={2} breakpoints={[{ maxWidth: "sm", cols: 1 }]}>
              <TextInput
                required
                size="md"
                maxLength={60}
                label={t("stundtransfer.form.uploader.label")}
                placeholder={t("stundtransfer.form.uploader.placeholder")}
                value={uploaderName}
                onChange={(e) => setUploaderName(e.currentTarget.value)}
              />
              <TextInput
                required
                size="md"
                maxLength={60}
                label={t("stundtransfer.form.video.label")}
                placeholder={t("stundtransfer.form.video.placeholder")}
                value={videoName}
                onChange={(e) => setVideoName(e.currentTarget.value)}
              />
            </SimpleGrid>
            <DepositDropzone maxSize={maxSize} onFiles={addFiles} />
            {fileSummary}
            <Button
              size="lg"
              fullWidth
              disabled={!fieldsFilled || selected.length === 0}
              onClick={send}
            >
              <FormattedMessage id="stundtransfer.button.send" />
            </Button>
            {!fieldsFilled && selected.length > 0 && (
              <Text size="sm" color="dimmed" align="center">
                <FormattedMessage id="stundtransfer.form.missing-fields" />
              </Text>
            )}
          </Stack>
        );

      case "resume": {
        const { state } = phase;
        const needed = state.files.filter((f) => f.status === "UPLOADING");
        const missing = needed.filter((f) => !selectedByKey.has(fileKey(f.path, f.size)));
        const receivedBytes = total(
          state.files.map((f) =>
            f.status !== "UPLOADING"
              ? f.size
              : total(
                  (f.receivedChunks ?? []).map((i) => chunkLength(f.size, state.chunkSize, i)),
                ),
          ),
        );
        return (
          <Stack spacing="lg">
            <Alert
              color="orange"
              icon={<TbRefresh />}
              title={t("stundtransfer.resume.title")}
            >
              {t("stundtransfer.resume.description", {
                uploader: state.uploaderName,
                video: state.videoName,
                received: humanSize(receivedBytes),
                total: humanSize(state.totalSize),
              })}
            </Alert>
            <DepositDropzone maxSize={state.totalSize} onFiles={addFiles} />
            <Text weight={600}>
              {t("stundtransfer.resume.matched", {
                matched: needed.length - missing.length,
                needed: needed.length,
              })}
            </Text>
            {missing.length > 0 && (
              <Text size="sm" color="dimmed">
                {t("stundtransfer.resume.missing", {
                  names:
                    missing
                      .slice(0, 5)
                      .map((f) => f.path)
                      .join(", ") + (missing.length > 5 ? ", …" : ""),
                })}
              </Text>
            )}
            <Button size="lg" fullWidth disabled={missing.length > 0} onClick={resume}>
              <FormattedMessage id="stundtransfer.resume.button" />
            </Button>
            <Button variant="subtle" color="gray" onClick={startOver}>
              <FormattedMessage id="stundtransfer.resume.abandon" />
            </Button>
          </Stack>
        );
      }

      case "preparing":
      case "uploading":
      case "finishing": {
        const percent =
          progress && progress.totalBytes > 0
            ? (progress.sentBytes / progress.totalBytes) * 100
            : phase.name === "finishing"
              ? 100
              : 0;
        return (
          <Stack spacing="lg">
            <div>
              <Title order={2}>
                <FormattedMessage
                  id={
                    phase.name === "preparing"
                      ? "stundtransfer.upload.preparing"
                      : phase.name === "finishing"
                        ? "stundtransfer.upload.finishing"
                        : "stundtransfer.upload.title"
                  }
                />
              </Title>
              <Text color="dimmed">
                {uploaderName.trim()} · {videoName.trim()}
              </Text>
            </div>
            <Progress
              value={percent}
              size="xl"
              radius="xl"
              striped
              animate={phase.name !== "finishing"}
            />
            {progress && (
              <>
                <Group position="apart">
                  <Text weight={700} size="lg">
                    {Math.floor(percent)} %
                  </Text>
                  <Text size="sm" color="dimmed">
                    {t("stundtransfer.upload.progress", {
                      sent: humanSize(progress.sentBytes),
                      total: humanSize(progress.totalBytes),
                    })}
                    {" · "}
                    {t("stundtransfer.upload.speed", {
                      speed: humanSize(progress.bytesPerSecond),
                    })}
                    {" · "}
                    {t("stundtransfer.upload.eta", {
                      eta: formatDuration(progress.secondsLeft),
                    })}
                  </Text>
                </Group>
                <Text size="sm">
                  {t("stundtransfer.upload.files", {
                    done: progress.filesDone,
                    total: progress.filesTotal,
                  })}
                </Text>
              </>
            )}
            {progress?.reconnecting && (
              <Alert color="orange" icon={<TbPlugConnectedX />}>
                <FormattedMessage id="stundtransfer.upload.reconnecting" />
              </Alert>
            )}
            <Alert color="blue" variant="light" icon={<TbInfoCircle />}>
              <FormattedMessage id="stundtransfer.upload.keep-open" />
            </Alert>
            {phase.name === "uploading" && (
              <Button
                variant="subtle"
                color="red"
                leftIcon={<TbX />}
                onClick={cancelUpload}
              >
                <FormattedMessage id="stundtransfer.upload.cancel" />
              </Button>
            )}
          </Stack>
        );
      }

      case "done":
        return (
          <Stack align="center" spacing="md" py="xl">
            <ThemeIcon size={80} radius={80} color="green" variant="light">
              <TbCircleCheck size={48} />
            </ThemeIcon>
            <Title order={2} align="center">
              <FormattedMessage id="stundtransfer.done.title" />
            </Title>
            <Text align="center">
              {t("stundtransfer.done.description", {
                count: phase.paths.length,
                size: humanSize(phase.totalSize),
              })}
            </Text>
            <Paper withBorder radius="md" p="md" style={{ width: "100%" }}>
              <Stack spacing={4}>
                {phase.paths.slice(0, DONE_PREVIEW_COUNT).map((path) => (
                  <Text key={path} size="sm" truncate>
                    {path}
                  </Text>
                ))}
                {phase.paths.length > DONE_PREVIEW_COUNT && (
                  <Text size="sm" color="dimmed">
                    {t("stundtransfer.files.more", {
                      count: phase.paths.length - DONE_PREVIEW_COUNT,
                    })}
                  </Text>
                )}
              </Stack>
            </Paper>
            <Button variant="light" onClick={startOver}>
              <FormattedMessage id="stundtransfer.done.again" />
            </Button>
          </Stack>
        );

      case "error": {
        const key = `stundtransfer.error.${phase.code}`;
        return (
          <Stack spacing="lg">
            <Alert
              color="red"
              icon={<TbAlertTriangle />}
              title={t("stundtransfer.error.title")}
            >
              {intl.messages[key]
                ? t(key, phase.values)
                : t("stundtransfer.error.unknown")}
            </Alert>
            <Button leftIcon={<TbRefresh />} onClick={checkInterruptedUpload}>
              <FormattedMessage id="stundtransfer.error.retry" />
            </Button>
          </Stack>
        );
      }
    }
  })();

  return (
    <>
      <Meta title={t("stundtransfer.page.title")} />
      <div style={{ maxWidth: 720, margin: "0 auto" }}>{content}</div>
    </>
  );
};

export default DepositPage;
