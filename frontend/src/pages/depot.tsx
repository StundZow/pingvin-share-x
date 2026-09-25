// StundTransfer: home page for visitors (the middleware shows it on "/").
// Public deposit (Admin > Configuration > StundTransfer): no account, no link.
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
  // undefined: loading, null: public deposit closed
  const [info, setInfo] = useState<LinkInfo | null>();

  useEffect(() => {
    stundTransferService
      .getPublicInfo()
      .then((publicInfo) => setInfo(publicInfo.depositMode ? publicInfo : null))
      .catch(() => setInfo(null));
  }, []);

  if (info === undefined) return <LoadingOverlay visible />;
  if (info) return <DepositPage info={info} />;
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
