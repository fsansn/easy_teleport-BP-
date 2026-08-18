import {
    world,
    system,
    LocationWaypoint,
    WaypointTexture,
} from "@minecraft/server";

/* -------------------------------------------------------
 * Easy Teleport
 * main.js
 * 前編
 * ------------------------------------------------------*/

const CONFIG = {
    DEBUG: false,

    COOLDOWN: 10,

    REQUIRE_SNEAK: true,

    SAFE_SEARCH_UP: 16,
    SAFE_SEARCH_DOWN: 16,

    LOAD_CHECK_INTERVAL: 1,

    LOAD_TIMEOUT: 40,

    TICKINGAREA_RADIUS: 2,
};

const ITEM = {
    COMPASS: "minecraft:compass",
    LODESTONE_COMPASS: "minecraft:lodestone_compass",
};

const BLOCK = {
    LODESTONE: "minecraft:lodestone",
};

const TELEPORT_FURNACES = [
    "minecraft:furnace",
    "minecraft:blast_furnace",
    "minecraft:smoker",
];

const MESSAGE = {
    PREFIX: "§e[Easy Teleport]§r",
    INFO: "§f",
    SUCCESS: "§b",
    ERROR: "§c",
};

const LORE_PREFIX = "ETP:";

const cooldown = new Map();
const teleportSessions = new Map();
const locatorWaypoints = new Map();

/* -------------------------------------------------------
 * 共通メッセージ
 * ------------------------------------------------------*/

function debug(player, text) {

    if (!CONFIG.DEBUG) return;

    player.sendMessage(
        `§7[DEBUG] ${text}`
    );

}

function info(player, item, text) {
    sendItemMessage(
        player,
        item,
        text,
        MESSAGE.INFO
    );
}

function success(player, item, text) {
    sendItemMessage(
        player,
        item,
        text,
        MESSAGE.SUCCESS
    );
}

function error(player, item, text) {
    sendItemMessage(
        player,
        item,
        text,
        MESSAGE.ERROR
    );
}

function sendItemMessage(
    player,
    item,
    message,
    color
) {

    player.sendMessage(
        `${MESSAGE.PREFIX} ${getItemName(item)} ${color}${message}`
    );

}

function getItemName(item) {

    try {

        if (
            item.nameTag &&
            item.nameTag.trim()
        ) {

            return item.nameTag;

        }

    } catch {}

    switch (item.typeId) {

        case ITEM.COMPASS:
            return "コンパス";

        case ITEM.LODESTONE_COMPASS:
            return "ロードストーンコンパス";

        default:
            return "アイテム";

    }

}

/* -------------------------------------------------------
 * ロードストーン登録
 * ------------------------------------------------------*/

world.afterEvents.playerInteractWithBlock.subscribe((ev) => {

    try {

        const player = ev.player;
        const used = ev.itemStack;

        if (!player || !used) return;

        if (
            used.typeId !== ITEM.COMPASS &&
            used.typeId !== ITEM.LODESTONE_COMPASS
        ) return;

        if (!ev.block) return;

        if (
            ev.block.typeId !==
            BLOCK.LODESTONE
        ) return;

        const save = {

            x: ev.block.location.x,
            y: ev.block.location.y,
            z: ev.block.location.z,
            dimension:
                ev.block.dimension.id,

        };

        system.runTimeout(() => {

            try {

                const inv =
                    player
                        .getComponent("minecraft:inventory")
                        .container;

                let target = null;

                if (
                    used.typeId ===
                    ITEM.LODESTONE_COMPASS
                ) {

                    target =
                        inv.getSlot(
                            player.selectedSlotIndex
                        );

                } else {

                    for (
                        let i = 0;
                        i < inv.size;
                        i++
                    ) {

                        const slot =
                            inv.getSlot(i);

                        const item =
                            slot.getItem();

                        if (
                            item &&
                            item.typeId ===
                                ITEM.LODESTONE_COMPASS &&
                            !item.getLore().some(v =>
                                v.startsWith(
                                    LORE_PREFIX
                                )
                            )
                        ) {

                            target = slot;
                            break;

                        }

                    }

                }

                if (!target) return;

                const item =
                    target.getItem();

                if (!item) return;

                const lore =
                    item.getLore()
                        .filter(v =>
                            !v.startsWith(
                                LORE_PREFIX
                            )
                        );

                lore.push(
                    LORE_PREFIX +
                    JSON.stringify(save)
                );

                item.setLore(lore);

                target.setItem(item);

                success(
                    player,
                    item,
                    "転移先を更新しました"
                );

            } catch (e) {

                console.warn(e);

            }

        }, 1);

    } catch (e) {

        console.warn(e);

    }

});

/* -------------------------------------------------------
 * コンパス使用転移
 * ------------------------------------------------------*/

world.afterEvents.itemUse.subscribe((ev) => {

    try {

        const player =
            ev.source;

        const item =
            ev.itemStack;

        if (
            !item ||
            item.typeId !==
            ITEM.LODESTONE_COMPASS
        ) return;

        if (
            CONFIG.REQUIRE_SNEAK &&
            !player.isSneaking
        ) {

            info(
                player,
                item,
                "スニーク中に使用すると転移できます"
            );

            return;

        }

        if (
            isCooldown(player)
        ) return;

        startCooldown(
            player
        );

        const data =
            readData(item);

        if (!data) {

            error(
                player,
                item,
                "未登録"
            );

            return;

        }

        if (
            player.dimension.id !==
            data.dimension
        ) {

            error(
                player,
                item,
                "ディメンションが違うので移動出来ません"
            );

            return;

        }

        requestTeleport(
            player,
            item,
            data
        );

    } catch (e) {

        console.warn(
            `[Easy Teleport][Compass Teleport] ${e}\n${e.stack ?? ""}`
        );

    }

});

/* -------------------------------------------------------
 * 転移炉
 * ------------------------------------------------------*/
world.beforeEvents.playerInteractWithBlock.subscribe((ev) => {

    try {

        const player = ev.player;

        if (!player.isSneaking) return;

        const equippable =
            player.getComponent("minecraft:equippable");

        const mainHand =
            equippable?.getEquipment("Mainhand");

        // 手ぶら以外は通常動作
        if (mainHand) return;

        const block = ev.block;

        if (!block) return;

        if (
            !TELEPORT_FURNACES.includes(block.typeId)
        ) {
            return;
        }

        const inventory =
            block.getComponent("minecraft:inventory");

        if (!inventory) return;

        const container =
            inventory.container;

        if (!container) return;

        const item =
            container.getItem(0);

        if (
            !item ||
            item.typeId !== ITEM.LODESTONE_COMPASS
        ) {

            info(
                player,
                {
                    typeId: ITEM.LODESTONE_COMPASS,
                    nameTag: "ロードストーンコンパス"
                },
                "入力スロットにロードストーンコンパスを入れてください"
            );

            ev.cancel = true;
            return;

        }

        const data =
            readData(item);

        if (!data) {

            error(
                player,
                item,
                "未登録"
            );

            ev.cancel = true;
            return;

        }

        if (
            player.dimension.id !==
            data.dimension
        ) {

            error(
                player,
                item,
                "ディメンションが違うので移動出来ません"
            );

            ev.cancel = true;
            return;

        }

        if (
            isCooldown(player)
        ) {

            ev.cancel = true;
            return;

        }

startCooldown(player);

// GUIを開かない
ev.cancel = true;

system.run(() => {
    requestTeleport(
        player,
        item,
        data
    );
});
    } catch (e) {

        console.warn(
            `[Easy Teleport] ${e}`
        );

    }

});

/* -------------------------------------------------------
 * 転移要求
 * ------------------------------------------------------*/

function requestTeleport(
    player,
    item,
    destination
) {

    const areaName =
        `etp_${player.id.replace(
            /[^a-zA-Z0-9]/g,
            "_"
        )}`;

    teleportSessions.set(
        player.id,
        {

            areaName,

            destination,

            item,

            tick: 0,

        }
    );

    debug(
        player,
        "転移要求開始"
    );

    createTickingArea(
        player
    );

}

/* -------------------------------------------------------
 * tickingarea作成
 * ------------------------------------------------------*/

function createTickingArea(
    player
) {

    const session =
        teleportSessions.get(
            player.id
        );

    if (!session) return;

    const d =
        session.destination;

    const command =
        `tickingarea add circle ${d.x} ${d.y} ${d.z} ${CONFIG.TICKINGAREA_RADIUS} ${session.areaName}`;

    debug(
        player,
        "tickingarea作成"
    );

try {

    player.dimension.runCommand(
        command
    );

    debug(
        player,
        "tickingarea追加成功"
    );

    waitChunkLoaded(
        player
    );

} catch (e) {

    console.warn(e);

    cleanupTeleport(
        player,
        "tickingarea作成失敗"
    );

}
}

/* -------------------------------------------------------
 * 読み込み待ち
 * ------------------------------------------------------*/

function waitChunkLoaded(
    player
) {

    const id =
        system.runInterval(() => {

            const session =
                teleportSessions.get(
                    player.id
                );

            if (!session) {

                system.clearRun(id);
                return;

            }

            session.tick++;

            const d =
                session.destination;

            const block =
                player.dimension.getBlock({

                    x: d.x,
                    y: d.y,
                    z: d.z,

                });

            debug(
                player,
                `読込確認 ${session.tick}`
            );

            if (!block) {

                if (
                    session.tick >=
                    CONFIG.LOAD_TIMEOUT
                ) {

                    system.clearRun(id);

                    cleanupTeleport(
                        player,
                        "チャンク読み込みタイムアウト"
                    );

                }

                return;

            }

            system.clearRun(id);

            searchSafeLocation(
                player
            );

        },
        CONFIG.LOAD_CHECK_INTERVAL
    );

}

/* -------------------------------------------------------
 * 続く
 * ------------------------------------------------------*/

/* -------------------------------------------------------
 * 安全地点検索
 * ------------------------------------------------------*/

function searchSafeLocation(
    player
) {

    const session =
        teleportSessions.get(
            player.id
        );

    if (!session) return;

    debug(
        player,
        "安全地点検索開始"
    );

    const safe =
        findSafe(
            player,
            player.dimension,
            session.destination
        );

    if (!safe) {

        cleanupTeleport(
            player,
            "安全な着地点が見つかりません"
        );

        return;

    }

    executeTeleport(
        player,
        safe
    );

}

/* -------------------------------------------------------
 * テレポート実行
 * ------------------------------------------------------*/

function executeTeleport(
    player,
    location
) {

    const session =
        teleportSessions.get(
            player.id
        );

    if (!session) return;

    debug(
        player,
        "プレイヤー転移"
    );

    player.playSound(
        "mob.endermen.portal"
    );

    player.teleport(
        location
    );

    success(
        player,
        session.item,
        "転移に成功しました"
    );

    cleanupTeleport(
        player
    );

}

/* -------------------------------------------------------
 * セッション終了
 * ------------------------------------------------------*/

function cleanupTeleport(
    player,
    failMessage = null
) {

    const session =
        teleportSessions.get(
            player.id
        );

    if (!session) return;

    debug(
        player,
        "tickingarea削除"
    );

try {

    player.dimension.runCommand(
        `tickingarea remove ${session.areaName}`
    );

} catch (e) {

    console.warn(e);

}

    if (failMessage) {

        error(
            player,
            session.item,
            failMessage
        );

    }

    teleportSessions.delete(
        player.id
    );

    debug(
        player,
        "転移終了"
    );

}

/* -------------------------------------------------------
 * 安全地点探索
 * ------------------------------------------------------*/

function findSafe(
    player,
    dimension,
    base
) {

    const range =
        getHeightRange(
            dimension
        );

    const maxDistance =
        Math.max(
            CONFIG.SAFE_SEARCH_UP,
            CONFIG.SAFE_SEARCH_DOWN
        );

    for (
        let i = 0;
        i <= maxDistance;
        i++
    ) {

        const offsets =
            i === 0
                ? [0]
                : [i, -i];

        for (
            const dy of offsets
        ) {

            const y =
                base.y + dy;

            if (
                y < range.min ||
                y + 1 > range.max
            ) {

                continue;

            }

            const feet =
                dimension.getBlock({

                    x: base.x,
                    y,
                    z: base.z,

                });

            const head =
                dimension.getBlock({

                    x: base.x,
                    y: y + 1,
                    z: base.z,

                });

            const floor =
                dimension.getBlock({

                    x: base.x,
                    y: y - 1,
                    z: base.z,

                });

            debug(
                player,
                `y=${y}`
            );

            if (
                feet?.isAir &&
                head?.isAir &&
                floor &&
                !floor.isAir
            ) {

                debug(
                    player,
                    `安全地点 ${y}`
                );

                return {

                    x: base.x + 0.5,
                    y,
                    z: base.z + 0.5,

                };

            }

        }

    }

    return null;

}

/* -------------------------------------------------------
 * 高さ範囲
 * ------------------------------------------------------*/

function getHeightRange(
    dimension
) {

    const range =
        dimension.heightRange;

    return {

        min: range.min,
        max: range.max,

    };

}

/* -------------------------------------------------------
 * Lore
 * ------------------------------------------------------*/

function readData(
    item
) {

    try {

        const line =
            item.getLore()
                .find(v =>
                    v.startsWith(
                        LORE_PREFIX
                    )
                );

        if (!line)
            return null;

        return JSON.parse(
            line.slice(
                LORE_PREFIX.length
            )
        );

    } catch {

        return null;

    }

}

/* -------------------------------------------------------
 * クールダウン
 * ------------------------------------------------------*/

function isCooldown(
    player
) {

    return cooldown.has(
        player.id
    );

}

function startCooldown(
    player
) {

    cooldown.set(
        player.id,
        true
    );

    system.runTimeout(() => {

        cooldown.delete(
            player.id
        );

    }, CONFIG.COOLDOWN);

}

/* -------------------------------------------------------
 * ロケーターバー
 * ------------------------------------------------------*/

function updateLocatorWaypoints() {

    for (const player of world.getAllPlayers()) {

        try {

            const state =
                locatorWaypoints.get(player.id);

            const equippable =
                player.getComponent(
                    "minecraft:equippable"
                );

            const held =
                equippable?.getEquipment(
                    "Mainhand"
                );

            // 登録済みロードストーンコンパス以外なら解除
            if (
                !held ||
                held.typeId !== ITEM.LODESTONE_COMPASS
            ) {

                if (state) {

                    state.waypoint.remove();

                    locatorWaypoints.delete(
                        player.id
                    );

                    debug(
                        player,
                        "ロケーターバー解除"
                    );

                }

                continue;

            }

            const data =
                readData(held);

            // Loreのないロードストーンコンパスなら解除
            if (!data) {

                if (state) {

                    state.waypoint.remove();

                    locatorWaypoints.delete(
                        player.id
                    );

                    debug(
                        player,
                        "ロケーターバー解除"
                    );

                }

                continue;

            }

            const key =
                `${data.dimension}:${data.x}:${data.y}:${data.z}`;

            // 同じ転移先なら何もしない
            if (
                state &&
                state.key === key
            ) {

                continue;

            }

            const dimension =
                world.getDimension(
                    data.dimension
                );

            const location = {

                dimension,
                x: data.x,
                y: data.y,
                z: data.z,

            };

            // 既存Waypointがあれば更新
            if (state) {

                state.waypoint
                    .setDimensionLocation(
                        location
                    );

                state.key = key;

                debug(
                    player,
                    "ロケーターバー更新"
                );

                continue;

            }

            const textureSelector = {

                textureBoundsList: [

                    {
                        lowerBound: 0,
                        texture:
                            WaypointTexture.Circle,
                    },

                ],

            };

            const waypoint =
                new LocationWaypoint(
                    location,
                    textureSelector
                );

            player.locatorBar.addWaypoint(
                waypoint
            );

            locatorWaypoints.set(
                player.id,
                {
                    waypoint,
                    key,
                }
            );

            debug(
                player,
                "ロケーターバー追加"
            );

        } catch (e) {

            console.warn(
                `[Easy Teleport] LocatorBar: ${e}`
            );

        }

    }

}

system.runInterval(
    updateLocatorWaypoints,
    1
);

/* -------------------------------------------------------
 * main.js 終了
 * ------------------------------------------------------*/