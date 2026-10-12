import {
  Baby, Bike, BookOpen, Camera, Car, Dog, Flower2, Gamepad2, Gift, House, LayoutGrid, Laptop, Music, Package,
  Refrigerator, Shirt, Smartphone, Sofa, Tv, Watch, Wrench, type LucideIcon,
} from "lucide-react";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  "layout-grid": LayoutGrid, sofa: Sofa, smartphone: Smartphone, shirt: Shirt, baby: Baby, house: House,
  refrigerator: Refrigerator, bike: Bike, car: Car, "book-open": BookOpen, package: Package, tv: Tv, laptop: Laptop,
  camera: Camera, "gamepad-2": Gamepad2, watch: Watch, wrench: Wrench, music: Music, dog: Dog, "flower-2": Flower2, gift: Gift,
};

export function CategoryIcon({ name, className }: { name: string; className?: string }) {
  const I = CATEGORY_ICONS[name] ?? Package;
  return <I className={className} aria-hidden />;
}
