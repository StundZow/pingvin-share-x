// StundTransfer: on a deposit link, shows the deposit page instead of
// Pingvin's reverse share upload page (used by pages/upload/[reverseShareToken].tsx).
import { LoadingOverlay } from "@mantine/core";
import { ComponentType, useEffect, useState } from "react";
import DepositPage from "./DepositPage";
import stundTransferService, { LinkInfo } from "./stundtransfer.service";

export default function withDepositMode<P extends { reverseShareToken: string }>(
  ReverseSharePage: ComponentType<P>,
) {
  const DepositOrReverseShare = (props: P) => {
    // undefined: loading, null: not a deposit link (or invalid: Pingvin shows its error)
    const [info, setInfo] = useState<LinkInfo | null>();

    useEffect(() => {
      stundTransferService
        .getLink(props.reverseShareToken)
        .then((link) => setInfo(link.depositMode ? link : null))
        .catch(() => setInfo(null));
    }, [props.reverseShareToken]);

    if (info === undefined) return <LoadingOverlay visible />;
    if (info) return <DepositPage token={props.reverseShareToken} info={info} />;
    return <ReverseSharePage {...props} />;
  };
  return DepositOrReverseShare;
}
