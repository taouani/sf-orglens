/**
 * Reads the contacts and the invoices of accounts through their child relationships, beside the lookups back.
 */
public with sharing class AccountInvoices {
    public static Map<Id, Integer> relatedCounts(Set<Id> accountIds) {
        Map<Id, Integer> counts = new Map<Id, Integer>();
        for (Account account : [
            SELECT Id,
                (SELECT Id FROM Contacts),
                (SELECT Id, Amount__c FROM Invoices__r WHERE Status__c = 'Sent')
            FROM Account
            WHERE Id IN :accountIds
        ]) {
            counts.put(account.Id, account.Contacts.size() + account.Invoices__r.size());
        }
        return counts;
    }

    public static Decimal goldTotal(Account account) {
        Decimal total = 0;
        for (Invoice__c invoice : account.Invoices__r) {
            if (invoice.Account__r.Tier__c == 'Gold') {
                total += invoice.Amount__c;
            }
            for (Invoice_Line__c line : invoice.Lines__r) {
                total += line.Line_Amount__c;
            }
        }
        return total;
    }

    public static List<String> contactNames(Account account) {
        List<String> names = new List<String>();
        for (Contact contact : account.Contacts) {
            names.add(contact.Account.Name + ': ' + contact.LastName);
        }
        for (Account other : account.Primary_Contact__r.Primary_Accounts__r) {
            names.add(other.Name);
        }
        return names;
    }
}
