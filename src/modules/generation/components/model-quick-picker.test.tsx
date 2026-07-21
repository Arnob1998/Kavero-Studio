import { fireEvent, render, screen } from "@testing-library/react";
import { Images } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { ModelQuickPicker } from "./model-quick-picker";

const options = [
  { value: "image-one", label: "Image One", description: "First active model" },
  { value: "image-two", label: "Image Two", description: "Second active model" },
];

describe("ModelQuickPicker", () => {
  it("shows the selected model and exposes checked active options", async () => {
    render(
      <ModelQuickPicker
        label="Image model"
        icon={Images}
        value="image-one"
        options={options}
        emptyLabel="No active models"
        onSelect={vi.fn()}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Image model: Image One" }), { button: 0 });

    expect(await screen.findByText("Second active model")).toBeInTheDocument();
    expect(screen.getByRole("menuitemradio", { name: /Image One/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: /Image Two/ })).toHaveAttribute("aria-checked", "false");
  });

  it("selects a model from the menu", async () => {
    const onSelect = vi.fn();
    render(
      <ModelQuickPicker
        label="Prompt model"
        icon={Images}
        value="image-one"
        options={options}
        emptyLabel="No active models"
        onSelect={onSelect}
      />,
    );

    fireEvent.pointerDown(screen.getByRole("button", { name: "Prompt model: Image One" }), { button: 0 });
    fireEvent.click(await screen.findByText("Image Two"));

    expect(onSelect).toHaveBeenCalledWith("image-two");
  });

  it("is disabled when no active models exist", () => {
    render(
      <ModelQuickPicker
        label="Image model"
        icon={Images}
        value=""
        options={[]}
        emptyLabel="No active models"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Image model: No active models" })).toBeDisabled();
  });
});
