import { Suspense } from "react";

import { PerfilHomeClient } from "./perfil-home-client";

export default function PerfilPage() {
  return (
    <Suspense>
      <PerfilHomeClient />
    </Suspense>
  );
}
