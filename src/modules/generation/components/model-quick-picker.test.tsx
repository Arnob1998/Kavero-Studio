import { fireEvent, render, screen } from "@testing-library/react";
import { Images } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { ModelQuickPicker } from "./model-quick-picker";

const options = [
  { value: "image-one", label: "Image One", description: "First active model" },
  { value: "image-two", label: "Image Two", description: "Second active model" },
];

describe("ModelQuickPicker", () => {
  it('shows cloud and local choices together, with visible capability limits and disabled reasons', async () => {
    const select = vi.fn();
    render(<ModelQuickPicker label="Image model" icon={Images} value="cloud:one" options={[
      {value: 'cloud:one', label: 'Cloud image', location: 'Cloud', description: 'Text to image · Reference editing'},
      {value: 'local:qwen', label: 'Qwen Image', location: 'This computer', description: 'Text to image only', disabledReason: 'Remove reference images before selecting.'},
    ]} emptyLabel="Choose image model" onSelect={select}/>);
    expect(screen.getByText('Image model · Cloud')).toBeVisible();
    fireEvent.pointerDown(screen.getByRole('button', {name: /Image model: Cloud image/}), {button: 0});
    const local = await screen.findByRole('menuitemradio', {name: /Qwen Image/});
    expect(local).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Remove reference images before selecting.')).toBeVisible();
    fireEvent.click(local); expect(select).not.toHaveBeenCalled();
  });
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
