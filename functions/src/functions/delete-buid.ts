import * as functions from "firebase-functions";
import {firestore} from "firebase-admin";
import {buildCloudFunction} from "../settings";
import * as t from "io-ts";
import {parseRequest} from "../lib/request";
import {FIRESTORE_CLIENT, isBuidOwnedByFuid} from "../lib/database";
import {deleteUploads} from "../lib/storage";

const RequestSchema = t.type({
    buid: t.string,
});

export const deleteBuidCallable = buildCloudFunction().https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError("unauthenticated", "Chybějící autentizace");
    }

    const payload = parseRequest(RequestSchema, data);
    const buid = payload.buid;
    const fuid = context.auth.uid;

    const registrations = FIRESTORE_CLIENT.collection("registrations");
    const buidDoc = await registrations.doc(buid).get();
    const buidLastUpdateTime = buidDoc.updateTime;

    if (!await isBuidOwnedByFuid(buid, fuid)) {
        throw new functions.https.HttpsError("unauthenticated", "Zařízení neexistuje nebo nepatří Vašemu účtu");
    }

    const users = FIRESTORE_CLIENT.collection("users");
    const userRef = users.doc(fuid);
    const batch = FIRESTORE_CLIENT.batch();
    const user = await userRef.get();
    const userLastUpdateTime = user.updateTime;

    try {
        batch.update(userRef, {
            registrationCount: firestore.FieldValue.increment(-1)
        });
        batch.delete(registrations.doc(buid), {
            lastUpdateTime: buidLastUpdateTime
        });
        await batch.commit();

        // not fully atomic
        if (user.get("registrationCount") === 1) {
            await userRef.delete({
                lastUpdateTime: userLastUpdateTime
            });
        }

        await deleteUploads(fuid, buid);
    } catch (error) {
        console.error(`Failed deleting buid ${buid}: ${error}`);
        throw new functions.https.HttpsError("unavailable", "Nepodařilo se smazat informace o zařízení");
    }
});
