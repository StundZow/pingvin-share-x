// StundTransfer: the only header item for visitors: a small "person" icon to sign in.
import { ActionIcon, Tooltip } from "@mantine/core";
import Link from "next/link";
import { TbUserCircle } from "react-icons/tb";
import useTranslate from "../hooks/useTranslate.hook";

const GuestSignInButton = () => {
  const t = useTranslate();
  const label = t("navbar.signin");
  return (
    <Tooltip label={label} position="bottom" withArrow>
      <ActionIcon
        component={Link}
        href="/auth/signIn"
        size="lg"
        radius="xl"
        variant="subtle"
        aria-label={label}
      >
        <TbUserCircle size={24} />
      </ActionIcon>
    </Tooltip>
  );
};

export default GuestSignInButton;
