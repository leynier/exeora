/**
 * The React primitives the dashboard and the Chrome side panel share.
 *
 * Raw TSX, compiled by whichever Vite build imports it, the way the protocol
 * package ships raw TypeScript. They know the design tokens and nothing about
 * projects, machines or git.
 */

export { BottomBar, type BottomBarItem } from "./BottomBar.js";
export { ContextMenu, type ContextMenuHandle, useContextMenu } from "./ContextMenu.js";
export { IconButton, type IconButtonProps } from "./IconButton.js";
export { MenuPanel } from "./MenuPanel.js";
export { isMenuAction, type MenuAction, type MenuEntry, menuStep } from "./menu.js";
export { type Align, type Placement, placeAnchored, placeAtPoint, type Side } from "./position.js";
export { ResizeHandle } from "./ResizeHandle.js";
export { SplitButton } from "./SplitButton.js";
export { type TabItem, Tabs } from "./Tabs.js";
export { Tooltip } from "./Tooltip.js";
export { TreeView } from "./TreeView.js";
export { iconButtonClass, iconClass, menuItemClass, menuPanelClass } from "./tokens.js";
export {
  ancestorsOf,
  flatten,
  isWithin,
  type TreeKeyResult,
  type TreeNode,
  treeKey,
  type VisibleNode,
} from "./treeModel.js";
