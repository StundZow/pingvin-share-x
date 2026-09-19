// StundTransfer: drop zone for files and whole folders (keeps the folder structure).
import { Button, Center, Group, Text, createStyles } from "@mantine/core";
import { Dropzone } from "@mantine/dropzone";
import { fromEvent } from "file-selector";
import { useEffect, useRef, useState } from "react";
import { TbCloudUpload, TbFolder } from "react-icons/tb";
import { FormattedMessage, useIntl } from "react-intl";
import { formatSize } from "./depositFiles";

const useStyles = createStyles(() => ({
  wrapper: { position: "relative", marginBottom: 30 },
  dropzone: { borderWidth: 1, paddingBottom: 50 },
  folderButton: { position: "absolute", bottom: -20 },
}));

function withRelativePath(file: File, relativePath: string) {
  Object.defineProperty(file, "webkitRelativePath", {
    value: relativePath,
    writable: true,
    configurable: true,
  });
  return file;
}

async function readEntry(entry: any, parent = ""): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) =>
      entry.file(
        (file: File) =>
          resolve([withRelativePath(file, parent ? `${parent}/${file.name}` : file.name)]),
        () => resolve([]),
      ),
    );
  }
  if (!entry.isDirectory) return [];

  const reader = entry.createReader();
  const children: any[] = [];
  // readEntries returns at most 100 entries per call
  for (;;) {
    const batch: any[] = await new Promise((resolve) =>
      reader.readEntries(resolve, () => resolve([])),
    );
    if (batch.length === 0) break;
    children.push(...batch);
  }
  const path = parent ? `${parent}/${entry.name}` : entry.name;
  return (await Promise.all(children.map((child) => readEntry(child, path)))).flat();
}

async function getFilesFromEvent(event: any): Promise<File[]> {
  const items = event?.dataTransfer?.items;
  if (items) {
    const entries = Array.from(items as DataTransferItemList)
      .filter((item) => item.kind === "file")
      .map((item) => ({ entry: item.webkitGetAsEntry?.(), file: item.getAsFile() }));
    const files = await Promise.all(
      entries.map(({ entry, file }) =>
        entry ? readEntry(entry) : Promise.resolve(file ? [file] : []),
      ),
    );
    return files.flat();
  }
  if (event?.target?.files) return Array.from(event.target.files as FileList);
  return (await fromEvent(event)) as File[];
}

const DepositDropzone = ({
  maxSize,
  disabled,
  onFiles,
}: {
  maxSize: number;
  disabled?: boolean;
  onFiles: (files: File[]) => void;
}) => {
  const { classes } = useStyles();
  const intl = useIntl();
  const folderInput = useRef<HTMLInputElement>(null);
  const [canPickFolder, setCanPickFolder] = useState(false);

  useEffect(() => {
    setCanPickFolder("webkitdirectory" in HTMLInputElement.prototype);
  }, []);

  return (
    <div className={classes.wrapper}>
      <input
        ref={folderInput}
        type="file"
        multiple
        style={{ display: "none" }}
        {...({ webkitdirectory: "", directory: "" } as object)}
        onChange={(event) => {
          onFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <Dropzone
        onDrop={(files) => onFiles(files as File[])}
        getFilesFromEvent={getFilesFromEvent}
        disabled={disabled}
        className={classes.dropzone}
        radius="md"
      >
        <div style={{ pointerEvents: "none" }}>
          <Group position="center">
            <TbCloudUpload size={50} />
          </Group>
          <Text align="center" weight={700} size="lg" mt="xl">
            <FormattedMessage id="stundtransfer.dropzone.title" />
          </Text>
          <Text align="center" size="sm" mt="xs" color="dimmed">
            <FormattedMessage
              id="stundtransfer.dropzone.description"
              values={{ maxSize: formatSize(maxSize, intl.locale) }}
            />
          </Text>
        </div>
      </Dropzone>
      {canPickFolder && (
        <Center>
          <Button
            className={classes.folderButton}
            variant="light"
            radius="xl"
            disabled={disabled}
            leftIcon={<TbFolder />}
            onClick={() => folderInput.current?.click()}
          >
            <FormattedMessage id="stundtransfer.dropzone.folder" />
          </Button>
        </Center>
      )}
    </div>
  );
};

export default DepositDropzone;
