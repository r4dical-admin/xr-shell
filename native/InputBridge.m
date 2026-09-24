#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>
#import <Foundation/Foundation.h>

static void Emit(NSDictionary *value) {
    NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    NSString *line = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    fprintf(stdout, "%s\n", line.UTF8String);
    fflush(stdout);
}

static BOOL IsTrusted(BOOL prompt) {
    NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @(prompt)};
    return AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
}

static BOOL WindowDetails(uint32_t windowID, pid_t *pid, CGRect *bounds) {
    CFArrayRef raw = CGWindowListCopyWindowInfo(kCGWindowListOptionIncludingWindow, (CGWindowID)windowID);
    NSArray *windows = CFBridgingRelease(raw);
    NSDictionary *info = windows.firstObject;
    if (!info) return NO;
    NSNumber *owner = info[(__bridge NSString *)kCGWindowOwnerPID];
    NSDictionary *boundsDictionary = info[(__bridge NSString *)kCGWindowBounds];
    if (!owner || !boundsDictionary || !CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)boundsDictionary, bounds)) return NO;
    *pid = owner.intValue;
    return YES;
}

static BOOL WindowTarget(uint32_t windowID, double x, double y, pid_t *pid, CGPoint *point) {
    CGRect bounds;
    if (!WindowDetails(windowID, pid, &bounds)) return NO;
    double nx = fmin(1.0, fmax(0.0, x));
    double ny = fmin(1.0, fmax(0.0, y));
    *point = CGPointMake(CGRectGetMinX(bounds) + CGRectGetWidth(bounds) * nx,
                         CGRectGetMinY(bounds) + CGRectGetHeight(bounds) * ny);
    return YES;
}

static id CopyAttribute(AXUIElementRef element, CFStringRef attribute) {
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, attribute, &value) != kAXErrorSuccess || !value) return nil;
    return CFBridgingRelease(value);
}

static NSString *CleanString(id value, NSUInteger limit) {
    if (![value isKindOfClass:NSString.class]) return nil;
    NSString *clean = [(NSString *)value stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if (!clean.length) return nil;
    return clean.length > limit ? [[clean substringToIndex:limit] stringByAppendingString:@"…"] : clean;
}

static BOOL ElementFrame(AXUIElementRef element, CGRect *frame) {
    id positionObject = CopyAttribute(element, kAXPositionAttribute);
    id sizeObject = CopyAttribute(element, kAXSizeAttribute);
    if (!positionObject || !sizeObject) return NO;
    AXValueRef positionValue = (__bridge AXValueRef)positionObject;
    AXValueRef sizeValue = (__bridge AXValueRef)sizeObject;
    if (CFGetTypeID(positionValue) != AXValueGetTypeID() || CFGetTypeID(sizeValue) != AXValueGetTypeID()) return NO;
    CGPoint position;
    CGSize size;
    if (!AXValueGetValue(positionValue, kAXValueCGPointType, &position)
        || !AXValueGetValue(sizeValue, kAXValueCGSizeType, &size)) return NO;
    *frame = (CGRect){ position, size };
    return size.width > 0 && size.height > 0;
}

static NSArray<NSString *> *CopyStringArray(CFArrayRef values) {
    if (!values) return @[];
    NSArray *source = CFBridgingRelease(values);
    NSMutableArray *result = [NSMutableArray array];
    for (id value in source) if ([value isKindOfClass:NSString.class]) [result addObject:value];
    return result;
}

static NSDictionary *SerializedElement(AXUIElementRef element, CGRect windowBounds, NSString *path) {
    NSString *role = CleanString(CopyAttribute(element, kAXRoleAttribute), 80) ?: @"AXUnknown";
    NSString *subrole = CleanString(CopyAttribute(element, kAXSubroleAttribute), 80);
    NSString *title = CleanString(CopyAttribute(element, kAXTitleAttribute), 160);
    NSString *description = CleanString(CopyAttribute(element, kAXDescriptionAttribute), 160);
    NSString *help = CleanString(CopyAttribute(element, kAXHelpAttribute), 160);
    NSString *placeholder = CleanString(CopyAttribute(element, kAXPlaceholderValueAttribute), 160);
    id rawValue = CopyAttribute(element, kAXValueAttribute);
    id safeValue = nil;
    if ([rawValue isKindOfClass:NSNumber.class]) safeValue = rawValue;
    if ([role isEqualToString:(__bridge NSString *)kAXStaticTextRole]) safeValue = CleanString(rawValue, 200);

    CGRect frame;
    if (!ElementFrame(element, &frame)) return nil;
    CGRect visible = CGRectIntersection(frame, windowBounds);
    if (CGRectIsNull(visible) || CGRectIsEmpty(visible)) return nil;

    CFArrayRef rawActions = NULL;
    AXUIElementCopyActionNames(element, &rawActions);
    NSArray *actions = CopyStringArray(rawActions);
    CFArrayRef rawAttributes = NULL;
    AXUIElementCopyAttributeNames(element, &rawAttributes);
    NSArray *attributes = CopyStringArray(rawAttributes);
    CFArrayRef rawParameterized = NULL;
    AXUIElementCopyParameterizedAttributeNames(element, &rawParameterized);
    NSArray *parameterized = CopyStringArray(rawParameterized);

    NSMutableDictionary *state = [NSMutableDictionary dictionary];
    id enabled = CopyAttribute(element, kAXEnabledAttribute);
    id focused = CopyAttribute(element, kAXFocusedAttribute);
    id selected = CopyAttribute(element, kAXSelectedAttribute);
    if ([enabled isKindOfClass:NSNumber.class]) state[@"enabled"] = enabled;
    if ([focused isKindOfClass:NSNumber.class]) state[@"focused"] = focused;
    if ([selected isKindOfClass:NSNumber.class]) state[@"selected"] = selected;

    double width = MAX(1.0, CGRectGetWidth(windowBounds));
    double height = MAX(1.0, CGRectGetHeight(windowBounds));
    NSMutableDictionary *result = [@{
        @"id": path,
        @"role": role,
        @"frame": @{
            @"x": @((CGRectGetMinX(frame) - CGRectGetMinX(windowBounds)) / width),
            @"y": @((CGRectGetMinY(frame) - CGRectGetMinY(windowBounds)) / height),
            @"width": @(CGRectGetWidth(frame) / width),
            @"height": @(CGRectGetHeight(frame) / height)
        },
        @"actions": actions,
        @"attributes": attributes,
        @"parameterizedAttributes": parameterized,
        @"state": state
    } mutableCopy];
    if (subrole) result[@"subrole"] = subrole;
    if (title) result[@"title"] = title;
    if (description) result[@"description"] = description;
    if (help) result[@"help"] = help;
    if (placeholder) result[@"placeholder"] = placeholder;
    if (safeValue) result[@"value"] = safeValue;
    return result;
}

static void CollectElements(AXUIElementRef element, CGRect bounds, NSString *path,
                            NSUInteger depth, NSMutableArray *output) {
    if (depth > 8 || output.count >= 240) return;
    NSDictionary *serialized = SerializedElement(element, bounds, path);
    if (serialized) [output addObject:serialized];
    id childObject = CopyAttribute(element, kAXChildrenAttribute);
    if (![childObject isKindOfClass:NSArray.class]) return;
    NSArray *children = childObject;
    NSUInteger count = MIN(children.count, 100);
    for (NSUInteger index = 0; index < count && output.count < 240; index++) {
        AXUIElementRef child = (__bridge AXUIElementRef)children[index];
        CollectElements(child, bounds, [path stringByAppendingFormat:@".%lu", (unsigned long)index], depth + 1, output);
    }
}

static NSDictionary *AccessibilitySnapshot(uint32_t windowID) {
    pid_t pid = 0;
    CGRect bounds;
    if (!WindowDetails(windowID, &pid, &bounds)) return @{@"ok": @NO, @"error": @"source-window-unavailable"};
    AXUIElementRef application = AXUIElementCreateApplication(pid);
    AXUIElementSetMessagingTimeout(application, 0.8);
    id windowObject = CopyAttribute(application, kAXWindowsAttribute);
    NSArray *windows = [windowObject isKindOfClass:NSArray.class] ? windowObject : @[];
    AXUIElementRef bestWindow = NULL;
    double bestScore = DBL_MAX;
    for (id candidateObject in windows) {
        AXUIElementRef candidate = (__bridge AXUIElementRef)candidateObject;
        CGRect candidateFrame;
        if (!ElementFrame(candidate, &candidateFrame)) continue;
        double score = fabs(CGRectGetMinX(candidateFrame) - CGRectGetMinX(bounds))
            + fabs(CGRectGetMinY(candidateFrame) - CGRectGetMinY(bounds))
            + fabs(CGRectGetWidth(candidateFrame) - CGRectGetWidth(bounds))
            + fabs(CGRectGetHeight(candidateFrame) - CGRectGetHeight(bounds));
        if (score < bestScore) { bestScore = score; bestWindow = candidate; }
    }
    if (!bestWindow) {
        CFRelease(application);
        return @{@"ok": @NO, @"error": @"accessibility-window-unavailable"};
    }
    NSMutableArray *elements = [NSMutableArray array];
    CollectElements(bestWindow, bounds, @"0", 0, elements);
    NSRunningApplication *running = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    NSString *windowTitle = CleanString(CopyAttribute(bestWindow, kAXTitleAttribute), 200) ?: @"";
    NSDictionary *snapshot = @{
        @"ok": @YES,
        @"app": @{
            @"pid": @(pid),
            @"name": running.localizedName ?: @"Unknown App",
            @"bundleId": running.bundleIdentifier ?: [NSString stringWithFormat:@"pid.%d", pid],
            @"windowTitle": windowTitle
        },
        @"window": @{
            @"id": @(windowID),
            @"width": @(CGRectGetWidth(bounds)),
            @"height": @(CGRectGetHeight(bounds))
        },
        @"elements": elements,
        @"capturedAt": @([[NSDate date] timeIntervalSince1970] * 1000.0)
    };
    CFRelease(application);
    return snapshot;
}

typedef struct {
    CGRect windowBounds;
} ObserverContext;

static void ObserverCallback(AXObserverRef observer, AXUIElementRef element,
                             CFStringRef notification, void *contextPointer) {
    (void)observer;
    ObserverContext *context = contextPointer;
    NSString *role = CleanString(CopyAttribute(element, kAXRoleAttribute), 80) ?: @"AXUnknown";
    NSString *title = CleanString(CopyAttribute(element, kAXTitleAttribute), 120);
    NSString *description = CleanString(CopyAttribute(element, kAXDescriptionAttribute), 120);
    NSMutableDictionary *event = [@{
        @"event": (__bridge NSString *)notification,
        @"role": role,
        @"at": @([[NSDate date] timeIntervalSince1970] * 1000.0)
    } mutableCopy];
    if (title) event[@"label"] = title;
    else if (description) event[@"label"] = description;
    CGRect frame;
    if (ElementFrame(element, &frame)) {
        double width = MAX(1.0, CGRectGetWidth(context->windowBounds));
        double height = MAX(1.0, CGRectGetHeight(context->windowBounds));
        event[@"frame"] = @{
            @"x": @((CGRectGetMinX(frame) - CGRectGetMinX(context->windowBounds)) / width),
            @"y": @((CGRectGetMinY(frame) - CGRectGetMinY(context->windowBounds)) / height),
            @"width": @(CGRectGetWidth(frame) / width),
            @"height": @(CGRectGetHeight(frame) / height)
        };
    }
    Emit(event);
}

static void CollectObserverElements(AXUIElementRef element, NSUInteger depth, NSMutableArray *output) {
    if (depth > 8 || output.count >= 240) return;
    [output addObject:CFBridgingRelease(CFRetain(element))];
    id childObject = CopyAttribute(element, kAXChildrenAttribute);
    if (![childObject isKindOfClass:NSArray.class]) return;
    NSArray *children = childObject;
    NSUInteger count = MIN(children.count, 100);
    for (NSUInteger index = 0; index < count && output.count < 240; index++) {
        CollectObserverElements((__bridge AXUIElementRef)children[index], depth + 1, output);
    }
}

static int ObserveWindow(uint32_t windowID) {
    if (!IsTrusted(NO)) { Emit(@{@"ready": @NO, @"error": @"accessibility-permission-required"}); return 2; }
    pid_t pid = 0;
    CGRect bounds;
    if (!WindowDetails(windowID, &pid, &bounds)) { Emit(@{@"ready": @NO, @"error": @"source-window-unavailable"}); return 3; }
    AXUIElementRef application = AXUIElementCreateApplication(pid);
    AXUIElementSetMessagingTimeout(application, 0.8);
    id windowObject = CopyAttribute(application, kAXWindowsAttribute);
    NSArray *windows = [windowObject isKindOfClass:NSArray.class] ? windowObject : @[];
    AXUIElementRef bestWindow = NULL;
    double bestScore = DBL_MAX;
    for (id candidateObject in windows) {
        AXUIElementRef candidate = (__bridge AXUIElementRef)candidateObject;
        CGRect candidateFrame;
        if (!ElementFrame(candidate, &candidateFrame)) continue;
        double score = fabs(CGRectGetMinX(candidateFrame) - CGRectGetMinX(bounds))
            + fabs(CGRectGetMinY(candidateFrame) - CGRectGetMinY(bounds))
            + fabs(CGRectGetWidth(candidateFrame) - CGRectGetWidth(bounds))
            + fabs(CGRectGetHeight(candidateFrame) - CGRectGetHeight(bounds));
        if (score < bestScore) { bestScore = score; bestWindow = candidate; }
    }
    if (!bestWindow) { CFRelease(application); Emit(@{@"ready": @NO, @"error": @"accessibility-window-unavailable"}); return 4; }

    AXObserverRef observer = NULL;
    if (AXObserverCreate(pid, ObserverCallback, &observer) != kAXErrorSuccess || !observer) {
        CFRelease(application);
        Emit(@{@"ready": @NO, @"error": @"observer-unavailable"});
        return 5;
    }
    NSMutableArray *elements = [NSMutableArray array];
    CollectObserverElements(bestWindow, 0, elements);
    NSArray<NSString *> *notifications = @[
        (__bridge NSString *)kAXFocusedUIElementChangedNotification,
        (__bridge NSString *)kAXFocusedWindowChangedNotification,
        (__bridge NSString *)kAXWindowCreatedNotification,
        (__bridge NSString *)kAXUIElementDestroyedNotification,
        (__bridge NSString *)kAXValueChangedNotification,
        (__bridge NSString *)kAXTitleChangedNotification,
        (__bridge NSString *)kAXMovedNotification,
        (__bridge NSString *)kAXResizedNotification,
        (__bridge NSString *)kAXSelectedChildrenChangedNotification,
        (__bridge NSString *)kAXSelectedRowsChangedNotification,
        (__bridge NSString *)kAXSelectedTextChangedNotification,
        (__bridge NSString *)kAXMenuOpenedNotification,
        (__bridge NSString *)kAXMenuClosedNotification,
        (__bridge NSString *)kAXLayoutChangedNotification,
        (__bridge NSString *)kAXRowCountChangedNotification,
        (__bridge NSString *)kAXSelectedCellsChangedNotification
    ];
    ObserverContext context = { .windowBounds = bounds };
    NSMutableSet *supported = [NSMutableSet set];
    for (id elementObject in elements) {
        AXUIElementRef element = (__bridge AXUIElementRef)elementObject;
        for (NSString *notification in notifications) {
            AXError error = AXObserverAddNotification(observer, element, (__bridge CFStringRef)notification, &context);
            if (error == kAXErrorSuccess || error == kAXErrorNotificationAlreadyRegistered) [supported addObject:notification];
        }
    }
    CFRunLoopSourceRef source = AXObserverGetRunLoopSource(observer);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), source, kCFRunLoopDefaultMode);
    Emit(@{@"ready": @YES, @"pid": @(pid), @"elementsObserved": @(elements.count), @"notifications": supported.allObjects});
    CFRunLoopRun();
    CFRunLoopRemoveSource(CFRunLoopGetCurrent(), source, kCFRunLoopDefaultMode);
    CFRelease(observer);
    CFRelease(application);
    return 0;
}

static CGEventFlags Flags(NSArray<NSString *> *names) {
    CGEventFlags flags = 0;
    for (NSString *name in names ?: @[]) {
        if ([name isEqualToString:@"command"]) flags |= kCGEventFlagMaskCommand;
        if ([name isEqualToString:@"shift"]) flags |= kCGEventFlagMaskShift;
        if ([name isEqualToString:@"option"]) flags |= kCGEventFlagMaskAlternate;
        if ([name isEqualToString:@"control"]) flags |= kCGEventFlagMaskControl;
    }
    return flags;
}

static BOOL PostPointer(NSDictionary *command, pid_t pid, CGPoint point, uint32_t windowID) {
    NSInteger number = [command[@"button"] integerValue];
    CGMouseButton button = number == 2 ? kCGMouseButtonRight : number == 1 ? kCGMouseButtonCenter : kCGMouseButtonLeft;
    NSString *phase = command[@"phase"] ?: @"move";
    CGEventType type;
    if ([phase isEqualToString:@"down"]) type = button == kCGMouseButtonRight ? kCGEventRightMouseDown : button == kCGMouseButtonCenter ? kCGEventOtherMouseDown : kCGEventLeftMouseDown;
    else if ([phase isEqualToString:@"up"]) type = button == kCGMouseButtonRight ? kCGEventRightMouseUp : button == kCGMouseButtonCenter ? kCGEventOtherMouseUp : kCGEventLeftMouseUp;
    else if ([phase isEqualToString:@"drag"]) type = button == kCGMouseButtonRight ? kCGEventRightMouseDragged : button == kCGMouseButtonCenter ? kCGEventOtherMouseDragged : kCGEventLeftMouseDragged;
    else type = kCGEventMouseMoved;
    CGEventRef event = CGEventCreateMouseEvent(NULL, type, point, button);
    if (!event) return NO;
    CGEventSetIntegerValueField(event, kCGMouseEventClickState, [command[@"clickCount"] integerValue] ?: 1);
    CGEventSetIntegerValueField(event, kCGMouseEventWindowUnderMousePointer, windowID);
    CGEventSetIntegerValueField(event, kCGMouseEventWindowUnderMousePointerThatCanHandleThisEvent, windowID);
    CGEventPostToPid(pid, event);
    CFRelease(event);
    return YES;
}

static BOOL HasAction(AXUIElementRef element, CFStringRef wanted) {
    CFArrayRef rawActions = NULL;
    if (AXUIElementCopyActionNames(element, &rawActions) != kAXErrorSuccess || !rawActions) return NO;
    NSArray *actions = CFBridgingRelease(rawActions);
    return [actions containsObject:(__bridge NSString *)wanted];
}

static BOOL FocusAndPlaceCaret(AXUIElementRef element, CGPoint point) {
    BOOL handled = AXUIElementSetAttributeValue(element, kAXFocusedAttribute, kCFBooleanTrue) == kAXErrorSuccess;
    AXValueRef pointValue = AXValueCreate(kAXValueCGPointType, &point);
    if (!pointValue) return handled;
    CFTypeRef range = NULL;
    AXError error = AXUIElementCopyParameterizedAttributeValue(element,
        kAXRangeForPositionParameterizedAttribute, pointValue, &range);
    CFRelease(pointValue);
    if (error == kAXErrorSuccess && range) {
        if (AXUIElementSetAttributeValue(element, kAXSelectedTextRangeAttribute, range) == kAXErrorSuccess) handled = YES;
        CFRelease(range);
    }
    return handled;
}

static BOOL ActivateAtPoint(pid_t pid, CGPoint point, NSInteger button) {
    AXUIElementRef application = AXUIElementCreateApplication(pid);
    AXUIElementSetMessagingTimeout(application, 0.8);
    AXUIElementRef hit = NULL;
    AXError hitError = AXUIElementCopyElementAtPosition(application, point.x, point.y, &hit);
    CFRelease(application);
    if (hitError != kAXErrorSuccess || !hit) return NO;

    BOOL handled = NO;
    AXUIElementRef current = hit;
    for (NSUInteger depth = 0; depth < 7 && current; depth++) {
        NSString *role = CleanString(CopyAttribute(current, kAXRoleAttribute), 80) ?: @"";
        if (button == 2 && HasAction(current, kAXShowMenuAction)) {
            handled = AXUIElementPerformAction(current, kAXShowMenuAction) == kAXErrorSuccess;
        } else if (button == 0 && ([role isEqualToString:(__bridge NSString *)kAXTextFieldRole]
                   || [role isEqualToString:(__bridge NSString *)kAXTextAreaRole])) {
            handled = FocusAndPlaceCaret(current, point);
        } else if (button == 0 && HasAction(current, kAXPressAction)) {
            handled = AXUIElementPerformAction(current, kAXPressAction) == kAXErrorSuccess;
        }
        if (handled) break;
        CFTypeRef parent = NULL;
        AXUIElementCopyAttributeValue(current, kAXParentAttribute, &parent);
        CFRelease(current);
        current = (AXUIElementRef)parent;
    }
    if (current) CFRelease(current);
    return handled;
}

static BOOL FallbackClick(NSDictionary *command, pid_t pid, CGPoint point, uint32_t windowID) {
    NSMutableDictionary *down = [command mutableCopy];
    down[@"phase"] = @"down";
    NSMutableDictionary *up = [command mutableCopy];
    up[@"phase"] = @"up";
    return PostPointer(down, pid, point, windowID) && PostPointer(up, pid, point, windowID);
}

static BOOL PostScroll(NSDictionary *command, pid_t pid, CGPoint point) {
    int32_t dy = (int32_t)-[command[@"deltaY"] doubleValue];
    int32_t dx = (int32_t)-[command[@"deltaX"] doubleValue];
    CGEventRef event = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitPixel, 2, dy, dx);
    if (!event) return NO;
    CGEventSetLocation(event, point);
    CGEventPostToPid(pid, event);
    CFRelease(event);
    return YES;
}

static BOOL PostText(NSDictionary *command, pid_t pid) {
    NSString *text = command[@"text"];
    if (!text.length) return NO;
    CGEventRef down = CGEventCreateKeyboardEvent(NULL, 0, true);
    CGEventRef up = CGEventCreateKeyboardEvent(NULL, 0, false);
    if (!down || !up) { if (down) CFRelease(down); if (up) CFRelease(up); return NO; }
    NSUInteger length = text.length;
    UniChar *characters = calloc(length, sizeof(UniChar));
    [text getCharacters:characters range:NSMakeRange(0, length)];
    CGEventKeyboardSetUnicodeString(down, length, characters);
    CGEventKeyboardSetUnicodeString(up, length, characters);
    CGEventFlags flags = Flags(command[@"modifiers"]);
    CGEventSetFlags(down, flags);
    CGEventSetFlags(up, flags);
    CGEventPostToPid(pid, down);
    CGEventPostToPid(pid, up);
    free(characters);
    CFRelease(down);
    CFRelease(up);
    return YES;
}

static BOOL PostKey(NSDictionary *command, pid_t pid) {
    CGKeyCode keyCode = (CGKeyCode)[command[@"keyCode"] unsignedShortValue];
    CGEventRef down = CGEventCreateKeyboardEvent(NULL, keyCode, true);
    CGEventRef up = CGEventCreateKeyboardEvent(NULL, keyCode, false);
    if (!down || !up) { if (down) CFRelease(down); if (up) CFRelease(up); return NO; }
    CGEventFlags flags = Flags(command[@"modifiers"]);
    CGEventSetFlags(down, flags);
    CGEventSetFlags(up, flags);
    CGEventPostToPid(pid, down);
    CGEventPostToPid(pid, up);
    CFRelease(down);
    CFRelease(up);
    return YES;
}

static NSArray *ElementChildren(AXUIElementRef element) {
    id children = CopyAttribute(element, kAXChildrenAttribute);
    return [children isKindOfClass:NSArray.class] ? children : @[];
}

static NSArray<NSString *> *MenuModifiers(id rawModifiers) {
    if (![rawModifiers isKindOfClass:NSNumber.class]) return @[];
    UInt32 flags = [rawModifiers unsignedIntValue];
    NSMutableArray *result = [NSMutableArray array];
    if (!(flags & kAXMenuItemModifierNoCommand)) [result addObject:@"command"];
    if (flags & kAXMenuItemModifierShift) [result addObject:@"shift"];
    if (flags & kAXMenuItemModifierOption) [result addObject:@"option"];
    if (flags & kAXMenuItemModifierControl) [result addObject:@"control"];
    return result;
}

static NSArray *SerializeMenuChildren(AXUIElementRef parent, NSArray<NSNumber *> *parentPath, NSUInteger depth) {
    if (depth > 5) return @[];
    NSArray *children = ElementChildren(parent);
    NSMutableArray *result = [NSMutableArray array];
    NSUInteger count = MIN(children.count, 160);
    for (NSUInteger index = 0; index < count; index++) {
        AXUIElementRef child = (__bridge AXUIElementRef)children[index];
        NSArray *path = [parentPath arrayByAddingObject:@(index)];
        NSString *role = CleanString(CopyAttribute(child, kAXRoleAttribute), 80) ?: @"";
        if ([role isEqualToString:(__bridge NSString *)kAXMenuRole]) {
            [result addObjectsFromArray:SerializeMenuChildren(child, path, depth + 1)];
            continue;
        }
        if (![role isEqualToString:(__bridge NSString *)kAXMenuItemRole]) continue;
        NSString *title = CleanString(CopyAttribute(child, kAXTitleAttribute), 160);
        id enabledObject = CopyAttribute(child, kAXEnabledAttribute);
        BOOL enabled = ![enabledObject isKindOfClass:NSNumber.class] || [enabledObject boolValue];
        NSString *mark = CleanString(CopyAttribute(child, kAXMenuItemMarkCharAttribute), 12);
        NSString *commandCharacter = CleanString(CopyAttribute(child, kAXMenuItemCmdCharAttribute), 12);
        id commandGlyph = CopyAttribute(child, kAXMenuItemCmdGlyphAttribute);
        NSArray *subitems = SerializeMenuChildren(child, path, depth + 1);
        NSMutableDictionary *item = [@{
            @"path": path,
            @"title": title ?: @"",
            @"enabled": @(enabled),
            @"separator": @(!title.length && !subitems.count),
            @"items": subitems,
            @"modifiers": MenuModifiers(CopyAttribute(child, kAXMenuItemCmdModifiersAttribute))
        } mutableCopy];
        if (mark) item[@"mark"] = mark;
        if (commandCharacter) item[@"command"] = commandCharacter;
        if ([commandGlyph isKindOfClass:NSNumber.class]) item[@"commandGlyph"] = commandGlyph;
        [result addObject:item];
    }
    return result;
}

static NSDictionary *MenuSnapshot(uint32_t windowID) {
    pid_t pid = 0;
    CGRect bounds;
    if (!WindowDetails(windowID, &pid, &bounds)) return @{@"ok": @NO, @"error": @"source-window-unavailable"};
    AXUIElementRef application = AXUIElementCreateApplication(pid);
    AXUIElementSetMessagingTimeout(application, 1.2);
    id menuBarObject = CopyAttribute(application, kAXMenuBarAttribute);
    if (!menuBarObject) { CFRelease(application); return @{@"ok": @NO, @"error": @"menu-bar-unavailable"}; }
    AXUIElementRef menuBar = (__bridge AXUIElementRef)menuBarObject;
    NSArray *topItems = ElementChildren(menuBar);
    NSMutableArray *menus = [NSMutableArray array];
    NSUInteger count = MIN(topItems.count, 24);
    for (NSUInteger index = 0; index < count; index++) {
        AXUIElementRef topItem = (__bridge AXUIElementRef)topItems[index];
        NSString *title = CleanString(CopyAttribute(topItem, kAXTitleAttribute), 80);
        if (!title) continue;
        id enabledObject = CopyAttribute(topItem, kAXEnabledAttribute);
        NSArray *path = @[@(index)];
        [menus addObject:@{
            @"title": title,
            @"path": path,
            @"enabled": @(![enabledObject isKindOfClass:NSNumber.class] || [enabledObject boolValue]),
            @"items": SerializeMenuChildren(topItem, path, 0)
        }];
    }
    NSRunningApplication *running = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
    NSDictionary *result = @{
        @"ok": @YES,
        @"app": @{
            @"pid": @(pid),
            @"name": running.localizedName ?: @"Unknown App",
            @"bundleId": running.bundleIdentifier ?: [NSString stringWithFormat:@"pid.%d", pid]
        },
        @"menus": menus,
        @"capturedAt": @([[NSDate date] timeIntervalSince1970] * 1000.0)
    };
    CFRelease(application);
    return result;
}

static AXUIElementRef CopyElementAtPath(AXUIElementRef root, NSArray *path) {
    AXUIElementRef current = (AXUIElementRef)CFRetain(root);
    for (id component in path) {
        if (![component isKindOfClass:NSNumber.class]) { CFRelease(current); return NULL; }
        NSInteger index = [component integerValue];
        NSArray *children = ElementChildren(current);
        if (index < 0 || index >= (NSInteger)children.count) { CFRelease(current); return NULL; }
        AXUIElementRef next = (__bridge AXUIElementRef)children[(NSUInteger)index];
        CFRetain(next);
        CFRelease(current);
        current = next;
    }
    return current;
}

static BOOL ActivateMenuItem(uint32_t windowID, NSArray *path) {
    if (![path isKindOfClass:NSArray.class] || !path.count || path.count > 8) return NO;
    pid_t pid = 0;
    CGRect bounds;
    if (!WindowDetails(windowID, &pid, &bounds)) return NO;
    AXUIElementRef application = AXUIElementCreateApplication(pid);
    AXUIElementSetMessagingTimeout(application, 1.2);
    id menuBarObject = CopyAttribute(application, kAXMenuBarAttribute);
    if (!menuBarObject) { CFRelease(application); return NO; }
    AXUIElementRef item = CopyElementAtPath((__bridge AXUIElementRef)menuBarObject, path);
    if (!item) { CFRelease(application); return NO; }
    id enabled = CopyAttribute(item, kAXEnabledAttribute);
    BOOL ok = ![enabled isKindOfClass:NSNumber.class] || [enabled boolValue];
    if (ok) ok = AXUIElementPerformAction(item, kAXPressAction) == kAXErrorSuccess;
    if (!ok) {
        NSRunningApplication *running = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
        [running activateWithOptions:0];
        ok = AXUIElementPerformAction(item, kAXPressAction) == kAXErrorSuccess;
    }
    CFRelease(item);
    CFRelease(application);
    return ok;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc == 3 && strcmp(argv[1], "--observe") == 0) return ObserveWindow((uint32_t)strtoul(argv[2], NULL, 10));
        char *buffer = NULL;
        size_t capacity = 0;
        while (getline(&buffer, &capacity, stdin) != -1) {
            @autoreleasepool {
                NSString *line = [NSString stringWithUTF8String:buffer];
                NSData *data = [line dataUsingEncoding:NSUTF8StringEncoding];
                NSDictionary *command = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
                NSNumber *requestID = command[@"id"] ?: @(-1);
                NSString *type = command[@"type"];
                if (![command isKindOfClass:NSDictionary.class] || !type) { Emit(@{@"id": requestID, @"ok": @NO, @"error": @"invalid-command"}); continue; }
                if ([type isEqualToString:@"status"]) {
                    Emit(@{@"id": requestID, @"ok": @YES, @"trusted": @(IsTrusted([command[@"prompt"] boolValue]))});
                    continue;
                }
                if (!IsTrusted(NO)) { Emit(@{@"id": requestID, @"ok": @NO, @"error": @"accessibility-permission-required"}); continue; }
                if ([type isEqualToString:@"snapshot"]) {
                    NSMutableDictionary *snapshot = [AccessibilitySnapshot([command[@"windowId"] unsignedIntValue]) mutableCopy];
                    snapshot[@"id"] = requestID;
                    Emit(snapshot);
                    continue;
                }
                if ([type isEqualToString:@"menu-snapshot"]) {
                    NSMutableDictionary *snapshot = [MenuSnapshot([command[@"windowId"] unsignedIntValue]) mutableCopy];
                    snapshot[@"id"] = requestID;
                    Emit(snapshot);
                    continue;
                }
                if ([type isEqualToString:@"menu-activate"]) {
                    BOOL ok = ActivateMenuItem([command[@"windowId"] unsignedIntValue], command[@"path"]);
                    Emit(@{@"id": requestID, @"ok": @(ok), @"error": ok ? NSNull.null : @"menu-action-failed"});
                    continue;
                }
                pid_t pid = 0;
                CGPoint point;
                if (!WindowTarget([command[@"windowId"] unsignedIntValue], [command[@"x"] doubleValue], [command[@"y"] doubleValue], &pid, &point)) {
                    Emit(@{@"id": requestID, @"ok": @NO, @"error": @"source-window-unavailable"});
                    continue;
                }
                BOOL ok = NO;
                if ([type isEqualToString:@"pointer"]) ok = PostPointer(command, pid, point, [command[@"windowId"] unsignedIntValue]);
                else if ([type isEqualToString:@"activate"]) {
                    ok = ActivateAtPoint(pid, point, [command[@"button"] integerValue]);
                    if (!ok) ok = FallbackClick(command, pid, point, [command[@"windowId"] unsignedIntValue]);
                }
                else if ([type isEqualToString:@"scroll"]) ok = PostScroll(command, pid, point);
                else if ([type isEqualToString:@"text"]) ok = PostText(command, pid);
                else if ([type isEqualToString:@"key"]) ok = PostKey(command, pid);
                Emit(@{@"id": requestID, @"ok": @(ok), @"error": ok ? NSNull.null : @"unsupported-input"});
            }
        }
        free(buffer);
    }
    return 0;
}
