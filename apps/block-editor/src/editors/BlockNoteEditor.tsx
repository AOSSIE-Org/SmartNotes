import "@blocknote/core/fonts/inter.css";
import {
  BlockNoteView,
  darkDefaultTheme,
  lightDefaultTheme,
  type Theme,
} from "@blocknote/mantine";
import "@blocknote/mantine/style.css";
import { useCreateBlockNote } from "@blocknote/react";

const lightTheme = {
  colors: {
    editor: {
      text: "#222222",
      background: "#ffffff",
    },
    menu: {
      text: "#3f3f3f",
      background: "#ffffff",
    },
    tooltip: {
      text: "#3f3f3f",
      background: "#efefef",
    },
    hovered: {
      text: "#3f3f3f",
      background: "#efefef",
    },
    selected: {
      text: "#ffffff",
      background: "#3f3f3f",
    },
    disabled: {
      text: "#afafaf",
      background: "#efefef",
    },
    shadow: "#cfcfcf",
    border: "#efefef",
    sideMenu: "#cfcfcf",
    highlights: lightDefaultTheme.colors!.highlights,
  },
  borderRadius: 6,
  fontFamily: "Inter, system-ui, sans-serif",
} satisfies Theme;

const darkTheme = {
  colors: {
    editor: {
      text: "#cfcfcf",
      background: "#1f1f1f",
    },
    menu: {
      text: "#cfcfcf",
      background: "#1f1f1f",
    },
    tooltip: {
      text: "#cfcfcf",
      background: "#161616",
    },
    hovered: {
      text: "#cfcfcf",
      background: "#161616",
    },
    selected: {
      text: "#cfcfcf",
      background: "#0f0f0f",
    },
    disabled: {
      text: "#3f3f3f",
      background: "#161616",
    },
    shadow: "#0f0f0f",
    border: "#2a2a2a",
    sideMenu: "#7f7f7f",
    highlights: darkDefaultTheme.colors!.highlights,
  },
  
  fontFamily: "Inter, system-ui, sans-serif",
} satisfies Theme;

const editorTheme = {
  light: lightTheme,
  dark: darkTheme,
};

interface BlockNoteEditorProps {
  isDark: boolean;
}

export default function BlockNoteEditor({ isDark }: BlockNoteEditorProps) {
  const editor = useCreateBlockNote({
    initialContent: [
      {
        type: "heading",
        props: { level: 1 },
        content: "Welcome to the Editor",
      },
      {
        type: "paragraph",
        content: 'Type "/" to open the slash menu and insert blocks.',
      },
      {
        type: "heading",
        props: { level: 2 },
        content: "Features",
      },
      {
        type: "bulletListItem",
        content: "Drag & drop blocks with the handle on the left",
      },
      {
        type: "bulletListItem",
        content: "Slash commands — press / to see all block types",
      },
      {
        type: "bulletListItem",
        content: "Rich text formatting: bold, italic, underline, code…",
      },
      {
        type: "bulletListItem",
        content: "Tables, images, code blocks, and more",
      },
      {
        type: "heading",
        props: { level: 2 },
        content: "Getting started",
      },
      {
        type: "paragraph",
        content: "Click anywhere to start editing. Enjoy! 🎉",
      },
    ],
  });

  return (
    <BlockNoteView
      editor={editor}
      theme={isDark ? "dark" : "light"}
    />
  );
}
