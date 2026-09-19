// StundTransfer: home page for visitors (the middleware shows it on "/").
// Opens the current deposit link directly: no account, no sign-in page.
import { Alert, LoadingOverlay } from "@mantine/core";
import { useEffect, useState } from "react";
import { TbInfoCircle } from "react-icons/tb";
import { FormattedMessage } from "react-intl";
import Meta from "../components/Meta";
import useTranslate from "../hooks/useTranslate.hook";
import DepositPage from "../stundtransfer/DepositPage";
import stundTransferService, { LinkInfo } from "../stundtransfer/stundtransfer.service";

const Depot = () => {
  const t = useTranslate();
  // undefined: loading, null: no open deposit link
  const [link, setLink] = useState<{ token: string; info: LinkInfo } | null>();

  useEffect(() => {
    (async () => {
      const { token } = await stundTransferService.getGuestLink();
      const info = await stundTransferService.getLink(token);
      setLink(info.depositMode ? { token, info } : null);
    })().catch(() => setLink(null));
  }, []);

  if (link === undefined) return <LoadingOverlay visible />;
  if (link) return <DepositPage token={link.token} info={link.info} />;
  return (
    <>
      <Meta title={t("stundtransfer.page.title")} />
      <Alert
        icon={<TbInfoCircle />}
        title={t("stundtransfer.guest.closed.title")}
        style={{ maxWidth: 720, margin: "0 auto" }}
      >
        <FormattedMessage id="stundtransfer.guest.closed.description" />
      </Alert>
    </>
  );
};

export default Depot;
