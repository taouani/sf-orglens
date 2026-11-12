/**
 * Syntax that is easy to get wrong. A comment that looks like code: invoice.Unused_Field__c = 'x';
 */
public without sharing class ParserTorture {
    public enum Mode { FAST, SAFE }

    public interface Visitor {
        void visit(SObject record);
    }

    private static final String NOT_CODE = 'Unused_Field__c // is only text here';

    public static Decimal lastAmount {
        get {
            if (lastAmount == null) {
                Invoice__c latest = [SELECT Amount__c FROM Invoice__c ORDER BY CreatedDate DESC LIMIT 1];
                lastAmount = latest.Amount__c;
            }
            return lastAmount;
        }
        private set;
    }

    public static String describe(SObject record) {
        switch on record {
            when Invoice__c invoice {
                return 'Invoice ' + invoice.Name;
            }
            when Invoice_Line__c line {
                return 'Line ' + line.Quantity__c;
            }
            when null {
                return 'nothing';
            }
            when else {
                return NOT_CODE;
            }
        }
    }

    public static String tierOf(Invoice__c invoice) {
        return invoice?.Account__r?.Tier__c ?? 'Bronze';
    }

    public static Map<Id, List<Map<String, Set<Decimal>>>> nested() {
        return new Map<Id, List<Map<String, Set<Decimal>>>>();
    }

    public static List<List<SObject>> search(String term) {
        return [
            FIND :term IN NAME FIELDS
            RETURNING Invoice__c(Id, Name WHERE Status__c = 'Sent'),
                Account(Id, Tier__c)
        ];
    }

    public static List<Event> typeOf() {
        return [
            SELECT TYPEOF What
                WHEN Account THEN Tier__c, Credit_Limit__c
                WHEN Invoice__c THEN Amount__c
            END
            FROM Event
        ];
    }

    public static Decimal averagePaid() {
        AggregateResult row = [SELECT AVG(Amount__c) average FROM Invoice__c WHERE Status__c = 'Paid'];
        return (Decimal) row.get('average');
    }

    public static void upsertByExternalId(List<Invoice__c> invoices) {
        upsert invoices External_Id__c;
    }

    public static Database.UpsertResult[] upsertByToken(Invoice__c[] invoices) {
        return Database.upsert(invoices, InvoiceConstants.EXTERNAL_ID, false);
    }

    public static void deleteInChunks() {
        for (List<Invoice__c> chunk : [SELECT Id FROM Invoice__c WHERE Tax_Rate__c > 0]) {
            delete chunk;
        }
    }

    public static String shadow() {
        // The variable is named like an object. Its type is Contact.
        Contact account = new Contact(LastName = 'Shadow');
        return account.LastName;
    }

    public static String comments(Invoice__c invoice) {
        /* invoice.Unused_Field__c = 'in a block comment'; */
        String text = 'invoice.Unused_Field__c = 1; // in a string';
        return text + invoice.Status__c; // invoice.Unused_Field__c in a line comment
    }
}
