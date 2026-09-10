(() => {
  const menu =
    document.querySelector(".topbar__menu");

  if (!menu) {
    return;
  }

  const toggle =
    menu.querySelector(".topbar__menu-toggle");

  if (!toggle) {
    return;
  }

  const closeMenu = () => {
    menu.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  };

  toggle.addEventListener("click", () => {
    const isOpen =
      menu.classList.toggle("is-open");

    toggle.setAttribute(
      "aria-expanded",
      String(isOpen)
    );
  });

  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
    }
  });

  menu
    .querySelectorAll("a")
    .forEach((link) => {
      link.addEventListener("click", closeMenu);
    });
})();
