// StundTransfer: choose the folder where deposits arrive (admin only, see middleware /admin/*).
import {
  Alert,
  Anchor,
  Breadcrumbs,
  Button,
  Group,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useModals } from "@mantine/modals";
import { useEffect, useState } from "react";
import { TbFolder, TbFolderPlus, TbInfoCircle } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import Meta from "../../components/Meta";
import CenterLoader from "../../components/core/CenterLoader";
import useTranslate from "../../hooks/useTranslate.hook";
import stundTransferService, {
  Destination,
} from "../../stundtransfer/stundtransfer.service";
import toast from "../../utils/toast.util";
import { displayFolder } from "../../stundtransfer/depositFiles";

const NewFolderForm = ({ onCreate }: { onCreate: (name: string) => void }) => {
  const t = useTranslate();
  const [name, setName] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onCreate(name.trim());
      }}
    >
      <Stack>
        <TextInput
          data-autofocus
          label={t("stundtransfer.destination.new-folder.label")}
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          maxLength={120}
        />
        <Button type="submit" disabled={!name.trim()}>
          <FormattedMessage id="stundtransfer.destination.create" />
        </Button>
      </Stack>
    </form>
  );
};

const DestinationPage = () => {
  const t = useTranslate();
  const modals = useModals();
  const [destination, setDestination] = useState<Destination>();
  const [path, setPath] = useState<string>();
  const [folders, setFolders] = useState<string[]>();

  const open = (target: string) =>
    stundTransferService
      .listFolders(target)
      .then((result) => {
        setPath(result.path);
        setFolders(result.folders);
      })
      .catch(toast.axiosError);

  useEffect(() => {
    stundTransferService
      .getDestination()
      .then((current) => {
        setDestination(current);
        if (current.enabled) open(current.destination);
      })
      .catch(toast.axiosError);
  }, []);

  const choose = () =>
    stundTransferService
      .setDestination(path ?? "")
      .then((updated) => {
        setDestination(updated);
        toast.success(
          t("stundtransfer.destination.chosen", {
            folder: displayFolder(updated.rootName, updated.destination),
          }),
        );
      })
      .catch(toast.axiosError);

  const newFolder = () => {
    const id = modals.openModal({
      title: t("stundtransfer.destination.new-folder"),
      children: (
        <NewFolderForm
          onCreate={(name) =>
            stundTransferService
              .createFolder(path ?? "", name)
              .then((created) => {
                modals.closeModal(id);
                open(created.path);
              })
              .catch(toast.axiosError)
          }
        />
      ),
    });
  };

  if (!destination) return <CenterLoader />;

  const parts = (path ?? "").split("/").filter(Boolean);
  const isCurrent = (path ?? "") === destination.destination;

  return (
    <>
      <Meta title={t("stundtransfer.destination.title")} />
      <Title order={3} mb="lg">
        <FormattedMessage id="stundtransfer.destination.title" />
      </Title>
      <Stack>
        <Text>
          <FormattedMessage id="stundtransfer.destination.current" />{" "}
          <Text span weight={700}>
            {displayFolder(destination.rootName, destination.destination)}
          </Text>
        </Text>

        <Paper withBorder radius="md" p="md">
          <Group position="apart" mb="sm">
            <Breadcrumbs separator="›">
              {[destination.rootName, ...parts].map((name, i) => (
                <Anchor
                  key={i}
                  component="button"
                  type="button"
                  onClick={() => open(parts.slice(0, i).join("/"))}
                >
                  {name}
                </Anchor>
              ))}
            </Breadcrumbs>
            <Button
              variant="light"
              size="xs"
              leftIcon={<TbFolderPlus />}
              onClick={newFolder}
            >
              <FormattedMessage id="stundtransfer.destination.new-folder" />
            </Button>
          </Group>

          {!folders ? (
            <CenterLoader />
          ) : folders.length === 0 ? (
            <Text color="dimmed" size="sm" py="md">
              <FormattedMessage id="stundtransfer.destination.empty" />
            </Text>
          ) : (
            <Stack spacing={2} mah={420} sx={{ overflowY: "auto" }}>
              {folders.map((folder) => (
                <UnstyledButton
                  key={folder}
                  onClick={() => open([...parts, folder].join("/"))}
                  sx={(theme) => ({
                    padding: "6px 8px",
                    borderRadius: theme.radius.sm,
                    "&:hover": {
                      backgroundColor:
                        theme.colorScheme === "dark"
                          ? theme.colors.dark[5]
                          : theme.colors.gray[1],
                    },
                  })}
                >
                  <Group spacing="xs" noWrap>
                    <TbFolder />
                    <Text size="sm" truncate>
                      {folder}
                    </Text>
                  </Group>
                </UnstyledButton>
              ))}
            </Stack>
          )}

          <Group position="right" mt="md">
            <Button onClick={choose} disabled={isCurrent}>
              <FormattedMessage id="stundtransfer.destination.choose" />
            </Button>
          </Group>
        </Paper>

        <Alert icon={<TbInfoCircle />} variant="light">
          {t("stundtransfer.destination.help", { root: destination.rootName })}
        </Alert>
      </Stack>
    </>
  );
};

export default DestinationPage;
