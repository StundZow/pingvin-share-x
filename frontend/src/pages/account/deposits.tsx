// StundTransfer: history of the deposits received through deposit links.
import {
  ActionIcon,
  Badge,
  Box,
  Center,
  Group,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useModals } from "@mantine/modals";
import moment from "moment";
import { useEffect, useState } from "react";
import { TbListDetails, TbRefresh, TbTrash } from "react-icons/tb";
import { FormattedMessage, useIntl } from "react-intl";
import Meta from "../../components/Meta";
import CenterLoader from "../../components/core/CenterLoader";
import useTranslate from "../../hooks/useTranslate.hook";
import { formatSize } from "../../stundtransfer/depositFiles";
import stundTransferService, {
  AdminDeposit,
} from "../../stundtransfer/stundtransfer.service";
import toast from "../../utils/toast.util";

const STATUS_COLORS: Record<AdminDeposit["status"], string> = {
  UPLOADING: "blue",
  MOVING: "blue",
  DONE: "green",
  ERROR: "red",
  ABANDONED: "gray",
};

const Deposits = () => {
  const t = useTranslate();
  const intl = useIntl();
  const modals = useModals();
  const [deposits, setDeposits] = useState<AdminDeposit[]>();

  const load = () =>
    stundTransferService
      .listDeposits()
      .then(setDeposits)
      .catch(toast.axiosError);

  useEffect(() => {
    load();
    // Refresh while deposits are being uploaded or stored
    const timer = setInterval(load, 10 * 1000);
    return () => clearInterval(timer);
  }, []);

  const showDetails = async (deposit: AdminDeposit) => {
    const details = await stundTransferService
      .getDepositDetails(deposit.id)
      .catch(toast.axiosError);
    if (!details) return;
    modals.openModal({
      title: `${details.uploaderName} · ${details.videoName}`,
      size: "xl",
      children: (
        <Stack spacing="xs">
          {details.error && (
            <Text size="sm" color="red">
              {details.error}
            </Text>
          )}
          <Table fontSize="xs" striped>
            <thead>
              <tr>
                <th>{t("stundtransfer.admin.file.original")}</th>
                <th>{t("stundtransfer.admin.file.final")}</th>
                <th>{t("stundtransfer.admin.size")}</th>
              </tr>
            </thead>
            <tbody>
              {details.files?.map((file) => (
                <tr key={file.id}>
                  <td style={{ wordBreak: "break-all" }}>{file.originalPath}</td>
                  <td style={{ wordBreak: "break-all" }}>
                    {file.finalPath ?? (
                      <Text color={file.error ? "red" : "dimmed"}>
                        {file.error ?? "…"}
                      </Text>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {formatSize(file.size, intl.locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Stack>
      ),
    });
  };

  const retry = (deposit: AdminDeposit) =>
    stundTransferService
      .retryDeposit(deposit.id)
      .then(() => {
        toast.success(t("stundtransfer.admin.retry.done"));
        load();
      })
      .catch(toast.axiosError);

  const remove = (deposit: AdminDeposit) =>
    modals.openConfirmModal({
      title: t("stundtransfer.admin.remove.confirm.title"),
      children: (
        <Text size="sm">
          {t(
            ["UPLOADING", "ERROR"].includes(deposit.status)
              ? "stundtransfer.admin.remove.confirm.pending"
              : "stundtransfer.admin.remove.confirm.history",
          )}
        </Text>
      ),
      labels: {
        confirm: t("stundtransfer.admin.remove"),
        cancel: t("common.button.cancel"),
      },
      confirmProps: { color: "red" },
      onConfirm: () =>
        stundTransferService.removeDeposit(deposit.id).then(load).catch(toast.axiosError),
    });

  if (!deposits) return <CenterLoader />;

  return (
    <>
      <Meta title={t("stundtransfer.admin.title")} />
      <Title order={3} mb={30}>
        <FormattedMessage id="stundtransfer.admin.title" />
      </Title>
      {deposits.length === 0 ? (
        <Center style={{ height: "50vh" }}>
          <Text color="dimmed">
            <FormattedMessage id="stundtransfer.admin.empty" />
          </Text>
        </Center>
      ) : (
        <Box sx={{ display: "block", overflowX: "auto" }}>
          <Table verticalSpacing="sm">
            <thead>
              <tr>
                <th>{t("stundtransfer.admin.when")}</th>
                <th>{t("stundtransfer.admin.who")}</th>
                <th>{t("stundtransfer.admin.video")}</th>
                <th>{t("stundtransfer.admin.files")}</th>
                <th>{t("stundtransfer.admin.size")}</th>
                <th>{t("stundtransfer.admin.status")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {deposits.map((deposit) => (
                <tr key={deposit.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {moment(deposit.completedAt ?? deposit.createdAt).format("LLL")}
                  </td>
                  <td>{deposit.uploaderName}</td>
                  <td>{deposit.videoName}</td>
                  <td>{deposit.fileCount}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {formatSize(deposit.totalSize, intl.locale)}
                  </td>
                  <td>
                    <Tooltip
                      label={deposit.error}
                      disabled={!deposit.error}
                      multiline
                      width={320}
                      withArrow
                    >
                      <Badge color={STATUS_COLORS[deposit.status]}>
                        {t(`stundtransfer.admin.status.${deposit.status}`)}
                      </Badge>
                    </Tooltip>
                  </td>
                  <td>
                    <Group position="right" spacing="xs" noWrap>
                      <Tooltip label={t("stundtransfer.admin.details")}>
                        <ActionIcon
                          variant="light"
                          size={25}
                          onClick={() => showDetails(deposit)}
                        >
                          <TbListDetails />
                        </ActionIcon>
                      </Tooltip>
                      {deposit.status === "ERROR" && (
                        <Tooltip label={t("stundtransfer.admin.retry")}>
                          <ActionIcon
                            variant="light"
                            color="orange"
                            size={25}
                            onClick={() => retry(deposit)}
                          >
                            <TbRefresh />
                          </ActionIcon>
                        </Tooltip>
                      )}
                      {deposit.status !== "MOVING" && (
                        <Tooltip label={t("stundtransfer.admin.remove")}>
                          <ActionIcon
                            variant="light"
                            color="red"
                            size={25}
                            onClick={() => remove(deposit)}
                          >
                            <TbTrash />
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </Group>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Box>
      )}
    </>
  );
};

export default Deposits;
