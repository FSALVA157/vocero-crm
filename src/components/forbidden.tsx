import { ShieldOff } from "lucide-react";

/**
 * Pantalla de "sin acceso" (spec 004, criterio 4).
 *
 * Una sección prohibida se dice, no se disimula con un redirect mudo: quien
 * llega por una URL guardada tiene que entender por qué no entra y a quién
 * pedírselo, en vez de rebotar a la bandeja sin explicación.
 */
export function Forbidden({
  destino,
  detalle,
}: {
  /**
   * Incluye la preposición ya contraída ("al Agente", "a la marca"): en
   * castellano "a el" no existe, y componerlo aquí obligaría a adivinar el
   * género de cada sección.
   */
  destino: string;
  detalle?: string;
}) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <ShieldOff className="h-6 w-6 text-muted-foreground" />
        </div>
        <h2 className="mt-4 text-base font-semibold">No tienes acceso {destino}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {detalle ?? "Tu rol no incluye esta sección."} Pídele al propietario
          de la instancia que cambie tu rol en Configuración → Equipo.
        </p>
      </div>
    </div>
  );
}
