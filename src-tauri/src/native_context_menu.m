#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#import <stdint.h>

typedef void (*OpenHarnessPopupContextMenuImplementation)(
    id, SEL, NSMenu *, NSEvent *, NSView *);

static OpenHarnessPopupContextMenuImplementation originalPopupContextMenu;

const char *openharness_current_build_number(void) {
  static NSString *buildNumber;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    id value = [NSBundle.mainBundle
        objectForInfoDictionaryKey:@"CFBundleVersion"];
    if ([value isKindOfClass:NSString.class]) {
      buildNumber = [value copy];
    }
  });
  return buildNumber.UTF8String;
}

int32_t openharness_preferred_native_locale(void) {
  for (NSString *tag in NSLocale.preferredLanguages) {
    NSString *language =
        [NSLocale componentsFromLocaleIdentifier:tag][NSLocaleLanguageCode];
    if ([language isEqualToString:@"zh"]) {
      return 0;
    }
    if ([language isEqualToString:@"en"]) {
      return 1;
    }
  }
  return 0;
}

static BOOL hasWebKitMenuItemIdentifiers(NSMenu *menu) {
  for (NSMenuItem *item in menu.itemArray) {
    if ([item.identifier hasPrefix:@"WKMenuItemIdentifier"]) {
      return YES;
    }
  }
  return NO;
}

static BOOL isAllowedWebKitMenuItem(NSMenuItem *item) {
  if (item.isSeparatorItem) {
    return YES;
  }

  NSUserInterfaceItemIdentifier identifier = item.identifier;
  return [identifier isEqualToString:@"WKMenuItemIdentifierLookUp"] ||
         [identifier isEqualToString:@"WKMenuItemIdentifierSearchWeb"] ||
         [identifier isEqualToString:@"WKMenuItemIdentifierCopy"];
}

static void removeRedundantSeparators(NSMenu *menu) {
  BOOL previousWasSeparator = YES;
  for (NSInteger index = 0; index < menu.numberOfItems;) {
    NSMenuItem *item = [menu itemAtIndex:index];
    if (item.isSeparatorItem && previousWasSeparator) {
      [menu removeItemAtIndex:index];
      continue;
    }

    previousWasSeparator = item.isSeparatorItem;
    index += 1;
  }

  if (menu.numberOfItems > 0 &&
      [menu itemAtIndex:menu.numberOfItems - 1].isSeparatorItem) {
    [menu removeItemAtIndex:menu.numberOfItems - 1];
  }
}

static void filterWebKitContextMenu(NSMenu *menu) {
  // WKWebView has no public macOS delegate for partial menu customization.
  // Leave unknown menu implementations intact instead of deleting every item.
  if (!hasWebKitMenuItemIdentifiers(menu)) {
    return;
  }

  for (NSInteger index = menu.numberOfItems - 1; index >= 0; index -= 1) {
    if (!isAllowedWebKitMenuItem([menu itemAtIndex:index])) {
      [menu removeItemAtIndex:index];
    }
  }
  removeRedundantSeparators(menu);
}

static void openHarnessPopupContextMenu(id menuClass, SEL selector,
                                        NSMenu *menu, NSEvent *event,
                                        NSView *view) {
  if ([view isKindOfClass:WKWebView.class]) {
    filterWebKitContextMenu(menu);
  }
  originalPopupContextMenu(menuClass, selector, menu, event, view);
}

void openharness_install_webview_context_menu_filter(void) {
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    Method method = class_getClassMethod(
        NSMenu.class, @selector(popUpContextMenu:withEvent:forView:));
    if (method == NULL) {
      return;
    }

    originalPopupContextMenu =
        (OpenHarnessPopupContextMenuImplementation)method_getImplementation(method);
    if (originalPopupContextMenu != NULL) {
      method_setImplementation(method, (IMP)openHarnessPopupContextMenu);
    }
  });
}
