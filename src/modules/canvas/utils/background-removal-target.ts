import * as fabric from "fabric";

export function isBackgroundRemovalTarget(object: fabric.FabricObject | null | undefined): object is fabric.FabricImage {
  return (
    object instanceof fabric.FabricImage &&
    !(object as any)._isBgImage &&
    (object as any).kaveroKind !== "background-image" &&
    !Boolean((object as any).kaveroBgSrc)
  );
}
